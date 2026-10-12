import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { NEXT_CONTENT, NEXT_MANIFEST, nextFixtureUrl } from '../platform/contentFixture'
import type { ContentVersion } from '../shared/manifest'
import { dataPaths, readDeployment } from './deployment'
import { MANIFEST_URL } from './manifest'
import { statusCard } from './statusCard'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`

async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function deployed() {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  return { platform, core, m }
}

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

/** Publishes a variant of the next version (based on the standard next fixture) plus any new assets. */
function publishVariant(m: Machine, variant: ContentVersion, assets: Record<string, string> = {}) {
  Object.assign(m.remoteText!, nextContentHost().remoteText)
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [NEXT_MANIFEST.versions[0], variant] })
  for (const [hash, text] of Object.entries(assets)) m.remoteText![nextFixtureUrl(hash)] = text
}

/** Returns a copy of `content` whose shipped file at `destination` is `newText`, with its new hash. */
async function replaceShipped(content: ContentVersion, destination: string, newText: string): Promise<{ content: ContentVersion; hash: string }> {
  const hash = await sha256(newText)
  const cloned = structuredClone(content)
  let oldHash: string | undefined
  for (const tier of Object.values(cloned.tiers)) {
    for (const step of tier.recipe) {
      if (step.kind === 'copy' && step.to.toLowerCase() === destination.toLowerCase()) { oldHash = step.file; step.file = hash }
    }
  }
  if (!oldHash) throw new Error(`No shipped file at ${destination}`)
  cloned.files = cloned.files.filter((f) => f.sha256 !== oldHash)
  cloned.files.push({ sha256: hash, size: new TextEncoder().encode(newText).length, release: `content-${cloned.id}` })
  return { content: cloned, hash }
}

it('takes the new value for a key the player did not change', async () => {
  const { platform, m } = await deployed()
  const { content, hash } = await replaceShipped(NEXT_CONTENT, 'ReShade.ini', '[GENERAL]\nPresetPath=reshade-presets/New.ini\n')
  publishVariant(m, content, { [hash]: '[GENERAL]\nPresetPath=reshade-presets/New.ini\n' })
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=reshade-presets/New.ini\n')
})

it('lets Lucent win when the player and the new version both changed the same key', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nPresetPath=reshade-presets/Mine.ini\n')
  const { content, hash } = await replaceShipped(NEXT_CONTENT, 'ReShade.ini', '[GENERAL]\nPresetPath=reshade-presets/New.ini\n')
  publishVariant(m, content, { [hash]: '[GENERAL]\nPresetPath=reshade-presets/New.ini\n' })
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=reshade-presets/New.ini\n')
})

it('forces a reset key back to Lucent’s value', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nPresetPath=reshade-presets/Mine.ini\n')
  const variant = structuredClone(NEXT_CONTENT)
  variant.tiers['rtx-30-40'].resetKeys = [{ file: 'ReShade.ini', section: 'GENERAL', key: 'PresetPath' }]
  publishVariant(m, variant)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=\n')
})

it('removes keys the new version dropped, keeping them only in the backup', async () => {
  const { platform, m } = await deployed()
  const edited = '[GENERAL]\nPresetPath=reshade-presets/Mine.ini\n'
  await platform.writeText(`${GAME}\\ReShade.ini`, edited)
  const { content, hash } = await replaceShipped(NEXT_CONTENT, 'ReShade.ini', '[GENERAL]\nShowFrameRate=0\n')
  publishVariant(m, content, { [hash]: '[GENERAL]\nShowFrameRate=0\n' })
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  const merged = await platform.readText(`${GAME}\\ReShade.ini`)
  expect(merged).toBe('[GENERAL]\nShowFrameRate=0\n')
  expect(merged).not.toContain('PresetPath')
  expect(await platform.readText(`${(await dataPaths(platform, ROOT)).backups}\\${await sha256(edited)}`)).toBe(edited)
})

it('follows the new version’s layout and comments while keeping the player’s value', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nPresetPath=reshade-presets/Mine.ini\n')
  const incoming = '; New ReShade layout\n[GENERAL]\n; Pick a look in game\nPresetPath=\n'
  const { content, hash } = await replaceShipped(NEXT_CONTENT, 'ReShade.ini', incoming)
  publishVariant(m, content, { [hash]: incoming })
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('; New ReShade layout\n[GENERAL]\n; Pick a look in game\nPresetPath=reshade-presets/Mine.ini\n')
})

it('takes over a profile key the new version changed, so the value matches the new profile again', async () => {
  const { platform, m } = await deployed()
  const config = `${GAME}\\OptiScaler.ini`
  await platform.writeText(config, (await platform.readText(config)).replace('Passes = 2', 'Passes = 9'))
  const variant = structuredClone(NEXT_CONTENT)
  for (const profile of variant.tiers['rtx-30-40'].performanceProfiles!) {
    for (const setting of profile.settings) if (setting.key === 'Passes') setting.value = profile.id === 'fidelity' ? '3' : '1'
  }
  publishVariant(m, variant)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(core.getState()).toMatchObject({ selectedProfile: 'fidelity', deployment: { profile: 'fidelity' } })
  expect(await platform.readText(config)).toContain('Passes = 3')
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
})

it('keeps a profile-key change the new version did not change', async () => {
  const { platform, m } = await deployed()
  const config = `${GAME}\\OptiScaler.ini`
  await platform.writeText(config, (await platform.readText(config)).replace('Passes = 2', 'Passes = 9'))
  publishVariant(m, structuredClone(NEXT_CONTENT))
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(config)).toContain('Passes = 9')
})

it('keeps an edited shipped preset when Lucent’s version is unchanged', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\reshade-presets\\Example.ini`, 'My tweaks')
  publishVariant(m, structuredClone(NEXT_CONTENT))
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\reshade-presets\\Example.ini`)).toBe('My tweaks')
  expect(await platform.listFiles(GAME)).not.toContain('reshade-presets\\example (my edits).ini')
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
})

it('saves an edited preset as “(my edits)” when Lucent’s version also changed', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\reshade-presets\\Example.ini`, 'My tweaks')
  const { content, hash } = await replaceShipped(NEXT_CONTENT, 'reshade-presets/Example.ini', 'Preset 2')
  publishVariant(m, content, { [hash]: 'Preset 2' })
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\reshade-presets\\Example.ini`)).toBe('Preset 2')
  expect(await platform.readText(`${GAME}\\reshade-presets\\Example (my edits).ini`)).toBe('My tweaks')
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
  // The saved copy is a user file: a later repair leaves it alone.
  await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
  const drifted = await reopen(platform)
  await drifted.repair()
  expect(await platform.readText(`${GAME}\\reshade-presets\\Example (my edits).ini`)).toBe('My tweaks')
})

it('does not leave a “(my edits)” copy behind when the update fails partway', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\reshade-presets\\Example.ini`, 'My tweaks')
  const { content, hash } = await replaceShipped(NEXT_CONTENT, 'reshade-presets/Example.ini', 'Preset 2')
  publishVariant(m, content, { [hash]: 'Preset 2' })
  const core = await reopen(platform)
  const before = Object.fromEntries(await Promise.all((await platform.listFiles(GAME)).map(async (f) => [f, await platform.readText(`${GAME}\\${f}`)])))
  const copy = platform.copyFile.bind(platform)
  let gameWrites = 0
  platform.copyFile = async (from, to, replace) => {
    if (to.startsWith(`${GAME}\\`) && ++gameWrites === 3) throw new Error('Simulated write failure')
    await copy(from, to, replace)
  }
  await core.update()
  platform.copyFile = copy
  expect(core.getState().error).toBeTruthy()
  const after = Object.fromEntries(await Promise.all((await platform.listFiles(GAME)).map(async (f) => [f, await platform.readText(`${GAME}\\${f}`)])))
  expect(after).toEqual(before)
  expect(await platform.readText(`${GAME}\\reshade-presets\\Example.ini`)).toBe('My tweaks')
  expect((await readDeployment(platform, ROOT))?.contentVersion).toBe('2026.10.12')
})
