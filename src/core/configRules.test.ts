import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { NEXT_CONTENT, NEXT_MANIFEST, nextFixtureUrl } from '../platform/contentFixture'
import type { ConfigUpdateRule, ContentVersion } from '../shared/manifest'
import { PlatformError } from './platform'
import { dataPaths, readDeployment } from './deployment'
import { MANIFEST_URL } from './manifest'
import { LUCENT_LOG } from './log'
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

/** The next version with a new `ReShade.ini` baseline and the given update rule for it (none when `rule` is absent). */
async function nextWithReShadeBaseline(m: Machine, baseline: string, rule?: ConfigUpdateRule) {
  const { content, hash } = await replaceShipped(NEXT_CONTENT, 'ReShade.ini', baseline)
  if (rule) for (const config of content.tiers['rtx-20-30-40'].ownedConfigs) if (config.path === 'ReShade.ini') config.update = rule
  publishVariant(m, content, { [hash]: baseline })
}

const TUNED = '; My notes\n[GENERAL]\nPresetPath=reshade-presets/Mine.ini\n[INPUT]\nKeyOverlay=36,0,0,0\n'
const NEW_BASELINE = '; New ReShade layout\n[GENERAL]\nPresetPath=\nNewKey=on\n[INPUT]\nKeyOverlay=113,0,1,0\n'

it.each([undefined, 'keep'] as const)('keep (%s) leaves a tuned config untouched, even when the new content ships another', async (rule) => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, TUNED)
  await nextWithReShadeBaseline(m, NEW_BASELINE, rule)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(core.getState().deployment?.contentVersion).toBe('2026.11.02')
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(TUNED)
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
})

it('keep leaves a tuned OptiScaler.ini alone although the new content changes the profile values', async () => {
  const { platform, m } = await deployed()
  const config = `${GAME}\\OptiScaler.ini`
  await platform.writeText(config, (await platform.readText(config)).replace('Passes = 2', 'Passes = 9'))
  const variant = structuredClone(NEXT_CONTENT)
  for (const profile of variant.tiers['rtx-20-30-40'].performanceProfiles!) {
    for (const setting of profile.settings) if (setting.key === 'Passes') setting.value = '3'
  }
  publishVariant(m, variant)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(config)).toContain('Passes = 9')
  expect(core.getState()).toMatchObject({ selectedProfile: 'fidelity', deployment: { profile: 'fidelity' } })
})

it('addMissingKeys writes only the keys absent on disk and keeps the player’s values, layout and comments', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, TUNED)
  await nextWithReShadeBaseline(m, NEW_BASELINE, 'addMissingKeys')
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('; My notes\n[GENERAL]\nPresetPath=reshade-presets/Mine.ini\nNewKey=on\n[INPUT]\nKeyOverlay=36,0,0,0\n')
  // The journal backed up the file first, and nothing is drift.
  expect(await platform.readText(`${(await dataPaths(platform, ROOT)).backups}\\${await sha256(TUNED)}`)).toBe(TUNED)
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
})

it('addMissingKeys leaves the file alone when nothing is missing', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, TUNED)
  await nextWithReShadeBaseline(m, '[GENERAL]\nPresetPath=\n', 'addMissingKeys')
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(TUNED)
  const journal = (await readDeployment(platform, ROOT))!.journal
  expect(journal.some((entry) => Object.keys(entry.after).includes('ReShade.ini') && entry.after['ReShade.ini'] === null)).toBe(false)
})

it('replace backs the tuned file up, then writes the new baseline', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, TUNED)
  await nextWithReShadeBaseline(m, NEW_BASELINE, 'replace')
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(NEW_BASELINE)
  expect(await platform.readText(`${(await dataPaths(platform, ROOT)).backups}\\${await sha256(TUNED)}`)).toBe(TUNED)
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
})

it('replace writes OptiScaler.ini from the stored profile, with the new content’s values', async () => {
  const { platform, m } = await deployed()
  const config = `${GAME}\\OptiScaler.ini`
  const tuned = (await platform.readText(config)).replace('Passes = 2', 'Passes = 9')
  await platform.writeText(config, tuned)
  const variant = structuredClone(NEXT_CONTENT)
  const recipe = variant.tiers['rtx-20-30-40']
  for (const profile of recipe.performanceProfiles!) for (const setting of profile.settings) if (setting.key === 'Passes') setting.value = profile.id === 'fidelity' ? '3' : '1'
  recipe.ownedConfigs.find((c) => c.path === 'OptiScaler.ini')!.update = 'replace'
  publishVariant(m, variant)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(config)).toContain('Passes = 3')
  expect(await platform.readText(`${(await dataPaths(platform, ROOT)).backups}\\${await sha256(tuned)}`)).toBe(tuned)
  expect(core.getState().deployment).toMatchObject({ profile: 'fidelity', frameGenerationMode: null, hdrMode: null })
})

it('rollback restores a tuned config from the journal when the newer version replaced it', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, TUNED)
  await nextWithReShadeBaseline(m, NEW_BASELINE, 'replace')
  const core = await reopen(platform)
  await core.update()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(NEW_BASELINE)
  await core.applyVersion('2026.10.12')
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(TUNED)
})

it('rollback restores config bytes exactly when the journaled file has a UTF-8 BOM', async () => {
  const { platform, m } = await deployed()
  const tuned = '\uFEFF; tuned bytes\n[GENERAL]\nPresetPath=reshade-presets/Mine.ini\n'
  await platform.writeText(`${GAME}\\ReShade.ini`, tuned)
  await nextWithReShadeBaseline(m, NEW_BASELINE, 'replace')
  const core = await reopen(platform)
  await core.update()
  const paths = await dataPaths(platform, ROOT)
  const target = `${GAME}\\ReShade.ini`
  let restoredFromBackup = false
  const copyFile = platform.copyFile.bind(platform)
  platform.copyFile = async (from, to, replace, stagingDirectory) => {
    if (from.toLowerCase().startsWith(`${paths.backups.toLowerCase()}\\`) && to.toLowerCase() === target.toLowerCase()) restoredFromBackup = true
    return copyFile(from, to, replace, stagingDirectory)
  }
  await core.applyVersion('2026.10.12')
  platform.copyFile = copyFile
  expect(core.getState().error).toBeNull()
  expect(restoredFromBackup).toBe(true)
  expect(await platform.readText(target)).toBe(tuned)
})

it('does not overwrite a locked config during an update', async () => {
  const { platform, m } = await deployed()
  const config = `${GAME}\\ReShade.ini`
  const before = await platform.readText(config)
  await nextWithReShadeBaseline(m, NEW_BASELINE, 'replace')
  const read = platform.readText.bind(platform)
  platform.readText = async (path) => {
    if (path.toLowerCase() === config.toLowerCase()) throw new PlatformError('locked', 'Sharing violation', path)
    return read(path)
  }
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toMatch(/file is in use/i)
  platform.readText = read
  expect(await platform.readText(config)).toBe(before)
})

it('lets a keep update pass a locked config without touching it', async () => {
  const { platform, m } = await deployed()
  const config = `${GAME}\\ReShade.ini`
  const before = await platform.readText(config)
  await nextWithReShadeBaseline(m, NEW_BASELINE)
  const read = platform.readText.bind(platform)
  platform.readText = async (path) => {
    if (path.toLowerCase() === config.toLowerCase()) throw new PlatformError('locked', 'Sharing violation', path)
    return read(path)
  }
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  platform.readText = read
  expect(await platform.readText(config)).toBe(before)
})

it('addMissingKeys leaves a config that isn’t UTF-8 text as it is, and the activity log says so', async () => {
  const { platform, m } = await deployed()
  // Saved as UTF-16: Lucent can't merge keys into it, and it is still the player's file.
  const utf16 = '[\0G\0E\0N\0E\0R\0A\0L\0]\0'
  await platform.writeText(`${GAME}\\ReShade.ini`, utf16)
  await nextWithReShadeBaseline(m, NEW_BASELINE, 'addMissingKeys')
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(utf16)
  expect((await core.readLog(LUCENT_LOG))!.map((line) => line.text)).toContain('Config ReShade.ini: not readable as text, kept as it is')
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
})

it('adds a config new to the deployment under keep, and checks it from then on', async () => {
  const { platform, m } = await deployed()
  const text = '[Tool]\nEnabled=1\n'
  const hash = await sha256(text)
  const variant = structuredClone(NEXT_CONTENT)
  variant.files.push({ sha256: hash, size: text.length, release: `content-${variant.id}` })
  const recipe = variant.tiers['rtx-20-30-40']
  recipe.recipe.push({ kind: 'copy', file: hash, to: 'Tool.ini' })
  recipe.ownedConfigs.push({ path: 'Tool.ini' })
  publishVariant(m, variant, { [hash]: text })
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\Tool.ini`)).toBe(text)
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
  await platform.removeFile(`${GAME}\\Tool.ini`)
  expect(statusCard((await reopen(platform)).getState())).toMatchObject({ kind: 'drift', files: 1 })
})

it('a config the player deleted stays missing under keep so Repair can restore it', async () => {
  const { platform, m } = await deployed()
  await platform.removeFile(`${GAME}\\ReShade.ini`)
  await nextWithReShadeBaseline(m, NEW_BASELINE)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  await expect(platform.readText(`${GAME}\\ReShade.ini`)).rejects.toThrow(/Not found/)
  expect(statusCard(core.getState())).toMatchObject({ kind: 'drift', files: 1 })
})

it('the changelog names the files an update adds keys to or replaces, and the activity log has a line per file', async () => {
  const { platform, m } = await deployed()
  const variant = structuredClone(NEXT_CONTENT)
  const [reShade, optiScaler] = [variant.tiers['rtx-20-30-40'].ownedConfigs.find((c) => c.path === 'ReShade.ini')!, variant.tiers['rtx-20-30-40'].ownedConfigs.find((c) => c.path === 'OptiScaler.ini')!]
  reShade.update = 'replace'
  optiScaler.update = 'addMissingKeys'
  publishVariant(m, variant)
  const core = await reopen(platform)
  const card = statusCard(core.getState())
  expect(card).toMatchObject({ kind: 'update', changelog: [
    ...NEXT_CONTENT.changelog,
    'Adds missing keys to OptiScaler.ini. Your values stay.',
    'Replaces ReShade.ini with the tested setup. Lucent backs up your copy first.',
  ] })
  await core.update()
  expect(core.getState().error).toBeNull()
  const lines = (await core.readLog(LUCENT_LOG))!.map((line) => line.text)
  expect(lines).toContain('Config ReShade.ini: replaced from the new baseline, the previous file is backed up')
  expect(lines.some((line) => /^Config OptiScaler\.ini: (added \d+ missing keys? \(.*\)|no missing keys, kept as it is)$/.test(line))).toBe(true)
})

it('the changelog says nothing about configs under keep', async () => {
  const { platform, m } = await deployed()
  publishVariant(m, structuredClone(NEXT_CONTENT))
  const card = statusCard((await reopen(platform)).getState())
  expect(card).toMatchObject({ kind: 'update', changelog: NEXT_CONTENT.changelog })
})

it('a failed update undoes a replace from the journal, restoring the tuned file', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, TUNED)
  await nextWithReShadeBaseline(m, NEW_BASELINE, 'replace')
  const core = await reopen(platform)
  const snapshotBefore = Object.fromEntries(await Promise.all((await platform.listFiles(GAME)).map(async (f) => [f, await platform.readText(`${GAME}\\${f}`)])))
  // The new baseline is already on disk when the failure comes.
  const copyMany = platform.copyMany.bind(platform)
  let failed = false
  platform.copyMany = async (...args) => {
    await copyMany(...args)
    if (!failed && args[0].some((item) => item.to.toLowerCase().endsWith('\\reshade.ini'))) { failed = true; throw new Error('Simulated write failure') }
  }
  await core.update()
  platform.copyMany = copyMany
  expect(core.getState().error).toMatch(/restored the game folder/)
  const after = Object.fromEntries(await Promise.all((await platform.listFiles(GAME)).map(async (f) => [f, await platform.readText(`${GAME}\\${f}`)])))
  expect(after).toEqual(snapshotBefore)
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(TUNED)
  expect((await readDeployment(platform, ROOT))?.contentVersion).toBe('2026.10.12')
})

it('applying the older version again leaves the configs as they are, and Uninstall still brings back the vanilla folder', async () => {
  const { platform, m } = await deployed()
  await nextWithReShadeBaseline(m, NEW_BASELINE, 'replace')
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  await platform.writeText(`${GAME}\\ReShade.ini`, TUNED)
  await core.applyVersion('2026.10.12')
  expect(core.getState()).toMatchObject({ error: null, deployment: { contentVersion: '2026.10.12' } })
  // The older version gives ReShade.ini no rule, so it is kept.
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(TUNED)
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver'])
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

/** A copy of `content` that ships the example preset at `to` instead, or not at all. */
function moveExamplePreset(content: ContentVersion, to: string | null): ContentVersion {
  const from = 'reshade-presets/Example.ini'
  const cloned = structuredClone(content)
  for (const tier of Object.values(cloned.tiers)) {
    tier.recipe = tier.recipe.flatMap((step) => step.kind === 'copy' && step.to === from ? to ? [{ ...step, to }] : [] : [step])
    tier.shippedPresets = tier.shippedPresets.flatMap((preset) => preset.path === from ? to ? [{ ...preset, path: to }] : [] : [preset])
  }
  return cloned
}

it.each([['drops', null], ['renames', 'reshade-presets/Example 2.ini']] as const)('saves an edited preset as “(my edits)” when the new version %s it', async (_, to) => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\reshade-presets\\Example.ini`, 'My tweaks')
  publishVariant(m, moveExamplePreset(NEXT_CONTENT, to))
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\reshade-presets\\Example (my edits).ini`)).toBe('My tweaks')
  await expect(platform.readText(`${GAME}\\reshade-presets\\Example.ini`)).rejects.toThrow(/Not found/)
  if (to) expect(await platform.readText(`${GAME}\\${to}`)).toBe('Preset')
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
  // The saved copy is the player's: Uninstall leaves it.
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await platform.listFiles(GAME)).toEqual(['ffxiv_dx11.exe', 'ffxivgame.ver', 'reshade-presets\\example (my edits).ini'])
})

it('deletes a dropped preset the player never edited', async () => {
  const { platform, m } = await deployed()
  publishVariant(m, moveExamplePreset(NEXT_CONTENT, null))
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect((await platform.listFiles(GAME)).filter((path) => path.startsWith('reshade-presets'))).toEqual([])
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

// setKeys: an update sets the listed keys in a config the player has and leaves the rest of the file alone.
const SETTINGS = '; My notes\n[GENERAL]\nPresetPath=reshade-presets/Mine.ini\nSkipLoadingDisabledEffects=1\nNoDebugInfo=1\n[INPUT]\nKeyOverlay=36,0,0,0\n[OVERLAY]\nShowForceLoadEffectsButton=1\n'
const SET_BOTH = [{ section: 'GENERAL', key: 'SkipLoadingDisabledEffects', value: '0' }, { section: 'GENERAL', key: 'NoDebugInfo', value: '0' }]
const FOUR_K = '.\\reshade-presets\\Alive NEXT WIP\\Alive NEXT Stable 4K.ini'
const STABLE = '.\\reshade-presets\\Alive NEXT WIP\\Alive NEXT Stable.ini'
type KeySettings = NonNullable<ContentVersion['tiers'][string]['ownedConfigs'][number]['setKeys']>

/** The next version with `setKeys` on its ReShade.ini entry (and the given update rule). */
function nextWithKeys(m: Machine, setKeys: KeySettings, rule?: ConfigUpdateRule) {
  const content = structuredClone(NEXT_CONTENT)
  for (const config of content.tiers['rtx-20-30-40'].ownedConfigs) if (config.path === 'ReShade.ini') { config.setKeys = setKeys; if (rule) config.update = rule }
  publishVariant(m, content)
  return content
}

it('setKeys under keep sets only the listed keys, announces them, and leaves the rest of the file byte for byte', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, SETTINGS)
  nextWithKeys(m, SET_BOTH)
  const core = await reopen(platform)
  expect(statusCard(core.getState())).toMatchObject({ kind: 'update', changelog: [...NEXT_CONTENT.changelog, 'Sets SkipLoadingDisabledEffects and NoDebugInfo in ReShade.ini to the tested values. Your other settings stay.'] })
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(SETTINGS.replace('SkipLoadingDisabledEffects=1', 'SkipLoadingDisabledEffects=0').replace('NoDebugInfo=1', 'NoDebugInfo=0'))
  // The journal backed up the player's file first, and nothing is drift.
  expect(await platform.readText(`${(await dataPaths(platform, ROOT)).backups}\\${await sha256(SETTINGS)}`)).toBe(SETTINGS)
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
  const lines = (await core.readLog(LUCENT_LOG))!.map((line) => line.text)
  expect(lines).toContain('Config ReShade.ini: other settings kept as they are')
  expect(lines).toContain('Config ReShade.ini: set GENERAL/SkipLoadingDisabledEffects, GENERAL/NoDebugInfo')
})

it('setKeys adds a key the file lacks and leaves a file that already holds the values alone', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, TUNED)
  nextWithKeys(m, [{ section: 'GENERAL', key: 'NoDebugInfo', value: '0' }])
  const core = await reopen(platform)
  await core.update()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('; My notes\n[GENERAL]\nPresetPath=reshade-presets/Mine.ini\nNoDebugInfo=0\n[INPUT]\nKeyOverlay=36,0,0,0\n')

  const second = await deployed()
  await second.platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nNoDebugInfo=0\n')
  nextWithKeys(second.m, [{ section: 'GENERAL', key: 'NoDebugInfo', value: '0' }])
  const again = await reopen(second.platform)
  await again.update()
  expect(await second.platform.readText(`${GAME}\\ReShade.ini`)).toBe('[GENERAL]\nNoDebugInfo=0\n')
  expect((await readDeployment(second.platform, ROOT))!.journal.some((entry) => entry.after['ReShade.ini'] === null)).toBe(false)
})

it('setKeys with addMissingKeys writes the missing keys and the set keys in one write', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, TUNED)
  const { content, hash } = await replaceShipped(NEXT_CONTENT, 'ReShade.ini', NEW_BASELINE)
  for (const config of content.tiers['rtx-20-30-40'].ownedConfigs) if (config.path === 'ReShade.ini') { config.update = 'addMissingKeys'; config.setKeys = [{ section: 'INPUT', key: 'KeyOverlay', value: '113,0,1,0' }] }
  publishVariant(m, content, { [hash]: NEW_BASELINE })
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('; My notes\n[GENERAL]\nPresetPath=reshade-presets/Mine.ini\nNewKey=on\n[INPUT]\nKeyOverlay=113,0,1,0\n')
})

it('setKeys with ifPath moves a selected preset only when it names the removed one, however it is written', async () => {
  for (const [stored, expected] of [
    [FOUR_K, STABLE],
    ['./reshade-presets/alive next wip/ALIVE NEXT STABLE 4K.ini', STABLE],
    ['.\\reshade-presets\\ipsuShade\\Mine.ini', '.\\reshade-presets\\ipsuShade\\Mine.ini'],
    ['.\\ReShadePreset.ini', '.\\ReShadePreset.ini'],
  ]) {
    const { platform, m } = await deployed()
    await platform.writeText(`${GAME}\\ReShade.ini`, `[GENERAL]\nPresetPath=${stored}\nStartupPresetPath=${stored}\n`)
    nextWithKeys(m, [{ section: 'GENERAL', key: 'PresetPath', value: STABLE, ifPath: FOUR_K }, { section: 'GENERAL', key: 'StartupPresetPath', value: STABLE, ifPath: FOUR_K }])
    const core = await reopen(platform)
    await core.update()
    expect(core.getState().error).toBeNull()
    expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(`[GENERAL]\nPresetPath=${expected}\nStartupPresetPath=${expected}\n`)
  }
  // An ifPath key the file lacks is not added.
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, '[GENERAL]\nNoDebugInfo=1\n')
  nextWithKeys(m, [{ section: 'GENERAL', key: 'PresetPath', value: STABLE, ifPath: FOUR_K }])
  const core = await reopen(platform)
  await core.update()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('[GENERAL]\nNoDebugInfo=1\n')
})

it('setKeys apply once: a version that carries the same keys again leaves the player’s later choice alone', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, SETTINGS)
  const first = nextWithKeys(m, SET_BOTH)
  const core = await reopen(platform)
  await core.update()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toContain('SkipLoadingDisabledEffects=0')
  // The player turns skipping back on; the next version is the recipe copied forward, keys and all.
  await platform.writeText(`${GAME}\\ReShade.ini`, SETTINGS)
  const third = { ...structuredClone(first), id: '2026.11.03' }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [NEXT_MANIFEST.versions[0], first, third] })
  const later = await reopen(platform)
  const card = statusCard(later.getState())
  expect(card).toMatchObject({ kind: 'update', version: '2026.11.03' })
  expect(JSON.stringify(card)).not.toContain('Sets ')
  await later.update()
  expect(later.getState()).toMatchObject({ error: null, deployment: { contentVersion: '2026.11.03' } })
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(SETTINGS)
})

it('replace ignores setKeys, since the whole baseline is written', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, SETTINGS)
  const { content, hash } = await replaceShipped(NEXT_CONTENT, 'ReShade.ini', NEW_BASELINE)
  for (const config of content.tiers['rtx-20-30-40'].ownedConfigs) if (config.path === 'ReShade.ini') { config.update = 'replace'; config.setKeys = SET_BOTH }
  publishVariant(m, content, { [hash]: NEW_BASELINE })
  const core = await reopen(platform)
  expect(JSON.stringify(statusCard(core.getState()))).not.toContain('Sets ')
  await core.update()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(NEW_BASELINE)
})

it('setKeys never writes over a locked config', async () => {
  const { platform, m } = await deployed()
  const config = `${GAME}\\ReShade.ini`
  await platform.writeText(config, SETTINGS)
  nextWithKeys(m, SET_BOTH)
  const read = platform.readText.bind(platform)
  platform.readText = async (path) => {
    if (path.toLowerCase() === config.toLowerCase()) throw new PlatformError('locked', 'Sharing violation', path)
    return read(path)
  }
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toMatch(/file is in use/i)
  platform.readText = read
  expect(await platform.readText(config)).toBe(SETTINGS)
  expect((await readDeployment(platform, ROOT))?.contentVersion).toBe('2026.10.12')
})

it('setKeys leave a config that isn’t UTF-8 text as it is', async () => {
  const { platform, m } = await deployed()
  const utf16 = '[\0G\0E\0N\0E\0R\0A\0L\0]\0'
  await platform.writeText(`${GAME}\\ReShade.ini`, utf16)
  nextWithKeys(m, SET_BOTH)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(utf16)
})

it.each([['unedited', undefined], ['edited', 'My tweaks']] as const)('an update that drops a preset moves the selected preset off it and sets the ReShade toggles (%s preset)', async (_, edit) => {
  const { platform, m } = await deployed()
  const reshade = `${GAME}\\ReShade.ini`
  const preset = `${GAME}\\reshade-presets\\Example.ini`
  const player = '[GENERAL]\nPresetPath=.\\reshade-presets\\Example.ini\nStartupPresetPath=\nSkipLoadingDisabledEffects=1\nNoDebugInfo=1\n[INPUT]\nKeyOverlay=36,0,0,0\n'
  await platform.writeText(reshade, player)
  if (edit) await platform.writeText(preset, edit)
  const content = moveExamplePreset(NEXT_CONTENT, null)
  for (const config of content.tiers['rtx-20-30-40'].ownedConfigs) if (config.path === 'ReShade.ini') config.setKeys = [
    ...SET_BOTH,
    { section: 'GENERAL', key: 'PresetPath', value: '.\\reshade-presets\\Other.ini', ifPath: '.\\reshade-presets\\Example.ini' },
    { section: 'GENERAL', key: 'StartupPresetPath', value: '.\\reshade-presets\\Other.ini', ifPath: '.\\reshade-presets\\Example.ini' },
  ]
  publishVariant(m, content)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(reshade)).toBe('[GENERAL]\nPresetPath=.\\reshade-presets\\Other.ini\nStartupPresetPath=\nSkipLoadingDisabledEffects=0\nNoDebugInfo=0\n[INPUT]\nKeyOverlay=36,0,0,0\n')
  await expect(platform.readText(preset)).rejects.toThrow(/Not found/)
  const left = (await platform.listFiles(GAME)).filter((path) => path.startsWith('reshade-presets'))
  expect(left).toEqual(edit ? ['reshade-presets\\example (my edits).ini'] : [])
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
})

it('rolling back after a setKeys update restores the file the player had', async () => {
  const { platform, m } = await deployed()
  await platform.writeText(`${GAME}\\ReShade.ini`, SETTINGS)
  nextWithKeys(m, SET_BOTH)
  const core = await reopen(platform)
  await core.update()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toContain('NoDebugInfo=0')
  await core.applyVersion('2026.10.12')
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(SETTINGS)
})

// Content 2026.10.29 turns Automatic ReShade scene depth on: OptiScaler.ini adds missing keys, and a setKeys entry with
// ifPath `auto` switches the key on for a setup that took 2026.10.28 (where it shipped at `auto`) without touching a value the player set.
describe('OptiScaler.ini with addMissingKeys and a setKeys entry that waits for auto', () => {
  const BASELINE = '[FFXIV]\nPreviewNR=false\nAutomaticReShadeDepth=true\n'
  const WAIT_FOR_AUTO = [{ section: 'FFXIV', key: 'AutomaticReShadeDepth', value: 'true', ifPath: 'auto' }]
  // The plan's baseline also carries the install's own keys, so the player's file holds them too, as a real one does.
  const player = (ffxiv: string) => `[FFXIV]\n${ffxiv}\n[Logging]\nLogToFile=false\n\n[DlssNr]\nPasses=2\nSpatialCompression=false\nResidualFG=false\n`
  async function updateWith(disk: string) {
    const { platform, m } = await deployed()
    await platform.writeText(`${GAME}\\OptiScaler.ini`, disk)
    const { content, hash } = await replaceShipped(NEXT_CONTENT, 'OptiScaler.ini', BASELINE)
    for (const config of content.tiers['rtx-20-30-40'].ownedConfigs) if (config.path === 'OptiScaler.ini') { config.update = 'addMissingKeys'; config.setKeys = WAIT_FOR_AUTO }
    publishVariant(m, content, { [hash]: BASELINE })
    const core = await reopen(platform)
    await core.update()
    expect(core.getState().error).toBeNull()
    return platform.readText(`${GAME}\\OptiScaler.ini`)
  }

  it('adds the key switched on for a setup that never had it (2026.10.27), leaving the player’s other values', async () => {
    expect(await updateWith(player('PreviewNR=true'))).toBe(player('PreviewNR=true\nAutomaticReShadeDepth=true'))
  })

  it('switches the key on for a setup that took 2026.10.28 and still has it at auto, whatever its case or spacing', async () => {
    expect(await updateWith(player('PreviewNR=true\nAutomaticReShadeDepth=auto'))).toBe(player('PreviewNR=true\nAutomaticReShadeDepth=true'))
    expect(await updateWith(player('AutomaticReShadeDepth = AUTO\nPreviewNR=true'))).toBe(player('AutomaticReShadeDepth = true\nPreviewNR=true'))
  })

  it.each(['false', 'true'])('leaves a value the player set (%s) alone and does not rewrite the file', async (value) => {
    const disk = player(`AutomaticReShadeDepth=${value}\nPreviewNR=true`)
    expect(await updateWith(disk)).toBe(disk)
  })
})
