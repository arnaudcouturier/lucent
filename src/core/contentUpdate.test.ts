import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { NEXT_CONTENT, NEXT_MANIFEST, OPTISCALER_HASH, OPTISCALER_NEXT_HASH, PROFILE_MANIFEST, SHADER_HASH, nextFixtureUrl } from '../platform/contentFixture'
import { dataPaths, readableBackupPath, readDeployment } from './deployment'
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
  expect(await platform.readText(`${GAME}\\OptiScaler.ini`)).toMatch(/Passes = 2/)
  expect(core.getState()).toMatchObject({ selectedProfile: 'fidelity', deployment: { contentVersion: '2026.11.02', enabled: false, profile: 'fidelity' } })
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

it('keeps the selected ReShade preset and keybinds through an update: configs are the player’s unless the content says otherwise', async () => {
  const { platform, m } = await deployed()
  const edited = '[GENERAL]\nPresetPath=reshade-presets/Example.ini\n[INPUT]\nKeyOverlay=36,0,0,0\nKeyScreenshot=44,0,0,0\n'
  await platform.writeText(`${GAME}\\ReShade.ini`, edited)
  publishNext(m)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(`${GAME}\\ReShade.ini`)).toBe(edited)
  expect(statusCard((await reopen(platform)).getState())).toEqual({ kind: 'healthy' })
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

async function snapshot(platform: FakePlatform) {
  const files = await platform.listFiles(GAME)
  return Object.fromEntries(await Promise.all(files.map(async (f) => [f, await platform.readText(`${GAME}\\${f}`)])))
}

it('still opens on the deployment when the newer version can’t be planned, and announces nothing', async () => {
  const { platform, m } = await deployed()
  const broken = { ...NEXT_CONTENT, tiers: { ...NEXT_CONTENT.tiers, 'rtx-20-30-40': { ...NEXT_CONTENT.tiers['rtx-20-30-40'], entryFiles: [{ path: 'missing.dll' }] } } }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [NEXT_MANIFEST.versions[0], broken] })
  const core = await reopen(platform)
  expect(core.getState().deployment?.contentVersion).toBe('2026.10.12')
  expect(statusCard(core.getState())).toEqual({ kind: 'healthy' })
})

const SHADER = `${GAME}\\reshade-shaders\\Shaders\\Example.fx`
const SHADER_PATH = 'reshade-shaders/Shaders/Example.fx'
const SHADER_SNAPSHOT_KEY = 'reshade-shaders\\shaders\\example.fx'
const owned = (files: object) => Object.keys(files).map((p) => p.toLowerCase())

/** A game folder with its own file where the content deploys its example shader, which the next version drops. */
async function deployedOverShader() {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), { files: { [SHADER]: 'Game shader' } })
  const platform = createFakePlatform(m)
  const before = await snapshot(platform)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  core.finish()
  expect(await platform.readText(SHADER)).toBe('Shader')
  return { platform, core, m, before }
}

it('puts back the game’s own file when the new version no longer deploys what replaced it, and stops owning it', async () => {
  const { platform, m } = await deployedOverShader()
  publishNext(m)
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(SHADER)).toBe('Game shader')
  const record = (await readDeployment(platform, ROOT))!
  expect(owned(record.files)).not.toContain(SHADER_PATH.toLowerCase())
  expect(record.journal.at(-1)).toMatchObject({ step: { kind: 'restore', to: SHADER_PATH }, before: { [SHADER_PATH]: SHADER_HASH }, after: { [SHADER_PATH]: await platform.hashFile(SHADER) } })
  // The file is the game's again: Health doesn't check it, and the next Scan finds the deployment healthy.
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', drift: null, update: null })
  expect((await reopen(platform)).getState().activity).toMatchObject({ kind: 'deployment', drift: null, update: null })
})

it('still deletes a dropped file the deployment created where the game had none', async () => {
  const { platform, m } = await deployed()
  publishNext(m)
  await (await reopen(platform)).update()
  expect(await platform.listFiles(GAME)).not.toContain(SHADER_SNAPSHOT_KEY)
  const record = (await readDeployment(platform, ROOT))!
  expect(record.journal.at(-1)).toMatchObject({ step: { kind: 'delete', path: SHADER_PATH }, before: { [SHADER_PATH]: SHADER_HASH }, after: { [SHADER_PATH]: null } })
  expect(record.journal.some((entry) => entry.step?.kind === 'restore')).toBe(false)
})

it('uninstalls to the folder as it was, the game’s own file included, after an update gave that file back', async () => {
  const { platform, m, before } = await deployedOverShader()
  publishNext(m)
  const core = await reopen(platform)
  await core.update()
  await core.uninstall()
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(SHADER)).toBe('Game shader')
  expect(await snapshot(platform)).toEqual(before)
})

it('restoring to vanilla after that update leaves the replaced file out, as it did when the update deleted it', async () => {
  const { platform, m, before } = await deployedOverShader()
  publishNext(m)
  const core = await reopen(platform)
  await core.update()
  const folder = (await readDeployment(platform, ROOT))!.backupFolder!
  await core.uninstall(false)
  expect(core.getState().error).toBeNull()
  expect(await snapshot(platform)).toEqual(Object.fromEntries(Object.entries(before).filter(([path]) => path !== SHADER_SNAPSHOT_KEY)))
  // The player's copy of it stays in the readable backup.
  expect(await platform.readText(`${await readableBackupPath(platform, ROOT, folder)}\\${SHADER_PATH}`)).toBe('Game shader')
})

it('leaves the file it gave back alone in later updates', async () => {
  const { platform, m } = await deployedOverShader()
  publishNext(m)
  await (await reopen(platform)).update()
  const journaled = (await readDeployment(platform, ROOT))!.journal.length
  const later = { ...NEXT_CONTENT, id: '2026.12.01', changelog: ['A later fix.'] }
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...NEXT_MANIFEST, versions: [...NEXT_MANIFEST.versions, later] })
  const core = await reopen(platform)
  await core.update()
  expect(core.getState()).toMatchObject({ error: null, deployment: { contentVersion: '2026.12.01' } })
  expect(await platform.readText(SHADER)).toBe('Game shader')
  const record = (await readDeployment(platform, ROOT))!
  expect(record.journal.length).toBeGreaterThan(journaled)
  expect(record.journal.slice(journaled).flatMap((entry) => Object.keys(entry.before)).map((p) => p.toLowerCase())).not.toContain(SHADER_PATH.toLowerCase())
  expect(owned(record.files)).not.toContain(SHADER_PATH.toLowerCase())
  expect(core.getState().activity).toMatchObject({ kind: 'deployment', drift: null })
})

it('rolls back to the version that replaced the game’s file, taking it over again while it is still the game’s', async () => {
  const { platform, m, before } = await deployedOverShader()
  publishNext(m)
  await (await reopen(platform)).update()
  const core = await reopen(platform)
  await core.applyVersion('2026.10.12')
  expect(core.getState().error).toBeNull()
  expect(await platform.readText(SHADER)).toBe('Shader')
  expect(owned((await readDeployment(platform, ROOT))!.files)).toContain(SHADER_PATH.toLowerCase())
  await core.uninstall()
  expect(await snapshot(platform)).toEqual(before)
})

it('refuses that rollback when the player put a different file where the game’s own went', async () => {
  const { platform, m } = await deployedOverShader()
  publishNext(m)
  await (await reopen(platform)).update()
  await platform.writeText(SHADER, 'Player shader')
  const core = await reopen(platform)
  await core.applyVersion('2026.10.12')
  expect(core.getState().error).toMatch(/user files would be replaced: reshade-shaders\/Shaders\/Example\.fx/)
  expect(await platform.readText(SHADER)).toBe('Player shader')
  expect(core.getState().deployment?.contentVersion).toBe('2026.11.02')
})

it('deletes a swapped DLSS file the deployment took over, when the new version drops its own: a takeover removed it on purpose', async () => {
  const dll = `${GAME}\\nvngx_dlss.dll`
  const withDlss = (version: typeof NEXT_CONTENT) => ({ ...version, tiers: Object.fromEntries(Object.entries(version.tiers).map(([id, recipe]) => [id, {
    ...recipe, recipe: [...recipe.recipe, { kind: 'copy' as const, file: SHADER_HASH, to: 'nvngx_dlss.dll' }],
  }])) })
  const first = withDlss(PROFILE_MANIFEST.versions[0])
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), { files: { [dll]: 'Swapped DLSS', [`${dll}.dlsss`]: 'Swapper backup' } })
  m.remoteText![MANIFEST_URL] = JSON.stringify({ ...PROFILE_MANIFEST, versions: [first] })
  const platform = createFakePlatform(m)
  const before = await snapshot(platform)
  const deploy = createCore(platform)
  await deploy.scan()
  await deploy.continueSetup()
  await deploy.review()
  await deploy.deploy()
  deploy.finish()
  expect(deploy.getState().error).toBeNull()
  expect(await platform.readText(dll)).toBe('Shader')
  // The swapped file was removed as part of its setup before the content wrote its own, so the copy found nothing to replace.
  expect((await readDeployment(platform, ROOT))!.journal.filter((entry) => 'nvngx_dlss.dll' in entry.before).map((entry) => entry.step?.kind)).toEqual(['delete', 'copy'])
  Object.assign(m.remoteText!, { ...nextContentHost().remoteText, [MANIFEST_URL]: JSON.stringify({ ...NEXT_MANIFEST, versions: [first, NEXT_CONTENT] }) })
  const core = await reopen(platform)
  await core.update()
  expect(core.getState().error).toBeNull()
  await expect(platform.readText(dll)).rejects.toThrow('Not found')
  expect(owned((await readDeployment(platform, ROOT))!.files)).not.toContain('nvngx_dlss.dll')
  await core.uninstall()
  expect(await snapshot(platform)).toEqual(before)
})
