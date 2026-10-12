import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { NEXT_CONTENT, NEXT_MANIFEST, OPTISCALER_HASH, OPTISCALER_NEXT_HASH, nextFixtureUrl } from '../platform/contentFixture'
import { dataPaths } from './deployment'
import { MANIFEST_URL } from './manifest'
import { PlatformError } from './platform'
import { statusCard } from './statusCard'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`

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

/** Publishes the next content version on the fake release host. */
const publishNext = (m: Machine) => Object.assign(m.remoteText!, nextContentHost().remoteText)

async function reopen(platform: FakePlatform) {
  const core = createCore(platform)
  await core.scan()
  return core
}

it('announces a newer Stable version with its changelog and the size of the files not yet cached', async () => {
  const { platform, m } = await deployed()
  publishNext(m)
  const core = await reopen(platform)
  expect(statusCard(core.getState())).toEqual({ kind: 'update', version: '2026.11.02', changelog: NEXT_CONTENT.changelog, downloadSize: 12 })
  expect(platform.downloads).not.toContain(nextFixtureUrl(OPTISCALER_NEXT_HASH))
})

it('updates by downloading only the changed file, removing the dropped one, and keeping Disabled and the profile', async () => {
  const { platform, core: first, m } = await deployed()
  await first.selectProfile('balanced')
  await first.setEnabled(false)
  publishNext(m)
  const core = await reopen(platform)
  const downloads = platform.downloads.length
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(platform.downloads.slice(downloads)).toEqual([nextFixtureUrl(OPTISCALER_NEXT_HASH)])
  expect(await platform.readText(`${GAME}\\winmm.dll.disabled`)).toBe('OptiScaler 2')
  const files = await platform.listFiles(GAME)
  expect(files).not.toContain('winmm.dll')
  expect(files).not.toContain('reshade-shaders\\shaders\\example.fx')
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/Passes = 1/)
  expect(core.getState()).toMatchObject({ selectedProfile: 'balanced', deployment: { contentVersion: '2026.11.02', enabled: false, profile: 'balanced' } })
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', enabled: false, drift: null, update: null })
  expect(statusCard(core.getState())).toEqual({ kind: 'disabled' })
  // The previous version's files stay cached for a rollback.
  expect(await platform.readText(`${(await dataPaths(platform, ROOT)).cache}\\${OPTISCALER_HASH}`)).toBe('OptiScaler')
  expect((await reopen(platform)).getState().activity).toMatchObject({ kind: 'deployment', enabled: false, drift: null, update: null })
})

it('Skip hides the card, and the skipped version isn’t announced again after reopening', async () => {
  const { platform, m } = await deployed()
  publishNext(m)
  const core = await reopen(platform)
  await core.skipUpdate()
  expect(core.getState().error).toBeNull()
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
  expect(platform.downloads).not.toContain(nextFixtureUrl(OPTISCALER_NEXT_HASH))
})

it('announces a version newer than the skipped one', async () => {
  const { platform, m } = await deployed()
  publishNext(m)
  await (await reopen(platform)).skipUpdate()
  const later = { ...NEXT_CONTENT, id: '2026.12.01', changelog: ['A later fix.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [...NEXT_MANIFEST.versions, later] })
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'update', version: '2026.12.01', changelog: ['A later fix.'], downloadSize: 12 })
})

it('backs up an owned config the player changed, then replaces it with the new version’s', async () => {
  const { platform, m } = await deployed()
  const edited = '[GENERAL]\nPresetPath=reshade-presets/Example.ini\n'
  await platform.writeText(`${GAME}\\ReShade.ini`, edited)
  publishNext(m)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe('[GENERAL]\nPresetPath=\n')
  expect(await platform.readText(`${(await dataPaths(platform, ROOT)).backups}\\${await sha256(edited)}`)).toBe(edited)
})

it('leaves the game folder and the deployment as they were when the update fails partway', async () => {
  const { platform, m } = await deployed()
  publishNext(m)
  const core = await reopen(platform)
  const before = await snapshot(platform)
  const copy = platform.copyFile.bind(platform)
  let gameWrites = 0
  platform.copyFile = async (from, to, replace) => {
    if (to.startsWith(`${GAME}\\`) && ++gameWrites === 3) throw new PlatformError('disk-full', 'Disk full')
    await copy(from, to, replace)
  }
  await core.update()
  platform.copyFile = copy
  expect(core.getState()).toMatchObject({ recoveryRequired: false, error: expect.stringMatching(/disk space.*restored the game folder/) })
  expect(await snapshot(platform)).toEqual(before)
  expect(core.getState().deployment?.contentVersion).toBe('2026.10.12')
  expect(statusCard(core.getState())).toMatchObject({ kind: 'update', version: '2026.11.02', downloadSize: 0 })
  const reopened = await reopen(platform)
  expect(reopened.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
  await reopened.update()
  expect(reopened.getState().deployment?.contentVersion).toBe('2026.11.02')
})

it('refuses to update while the game runs', async () => {
  const { platform, m } = await deployed()
  publishNext(m)
  const core = await reopen(platform)
  platform.isGameRunning = async () => true
  await core.update()
  expect(core.getState().error).toMatch(/Close XIV/)
  expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
})

async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function snapshot(platform: FakePlatform) {
  const files = await platform.listFiles(GAME)
  return Object.fromEntries(await Promise.all(files.map(async (f) => [f, await platform.readText(`${GAME}\\${f}`)])))
}

it('still opens on the deployment when the newer version can’t be planned, and announces nothing', async () => {
  const { platform, m } = await deployed()
  const broken = { ...NEXT_CONTENT, tiers: { ...NEXT_CONTENT.tiers, 'rtx-30-40': { ...NEXT_CONTENT.tiers['rtx-30-40'], entryFiles: [{ path: 'missing.dll' }] } } }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [NEXT_MANIFEST.versions[0], broken] })
  const core = await reopen(platform)
  expect(core.getState().deployment?.contentVersion).toBe('2026.10.12')
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})
