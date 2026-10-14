import { expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, DEFAULT_ENV, FAKE_EXE_PATH, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, vanillaGame, xivLauncher } from '../platform/fixtures'
import { PlatformError } from './platform'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const DATA = `${DEFAULT_ENV.LocalAppData}\\Lucent`
const INSTALLED_EXE = `${DATA}\\Lucent.exe`
const SHORTCUT = `${DEFAULT_ENV.AppData}\\Microsoft\\Windows\\Start Menu\\Programs\\Lucent.lnk`
const ENTRY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Lucent'

const fixture = (...parts: Machine[]) => machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT), ...parts)
const exists = (platform: FakePlatform, path: string) => platform.stat(path).then(() => true, () => false)
const entry = (platform: FakePlatform, value: string) => platform.readRegistry('HKCU', ENTRY, value).catch(() => null)
const gameFolder = async (platform: FakePlatform) => ({
  files: Object.fromEntries(await Promise.all((await platform.listFiles(GAME)).sort().map(async (path) => [path, await platform.readText(`${GAME}\\${path}`)]))),
  directories: (await platform.listDirectories(GAME)).sort(),
})

async function deploy(platform: FakePlatform, addToStartMenu = true) {
  const core = createCore(platform)
  await core.scan()
  await core.review()
  if (!addToStartMenu) core.setAddToStartMenu(false)
  await core.deploy()
  core.finish()
  expect(core.getState()).toMatchObject({ error: null, activity: { kind: 'deployment' } })
  return core
}

/** Settings → Apps starts the installed copy with --uninstall. */
async function openFromSettings(m: Machine, platform: FakePlatform) {
  m.exePath = INSTALLED_EXE
  m.headlessMode = 'uninstall'
  const core = createCore(platform)
  await core.openAppUninstall()
  return core
}

it('offers to add Lucent to the Start menu on Review, on by default', async () => {
  const core = createCore(createFakePlatform(fixture()))
  await core.scan()
  await core.review()
  expect(core.getState()).toMatchObject({ activity: { kind: 'review' }, selfInstalled: false, addToStartMenu: true })
})

it('copies the running exe into the per-user Lucent folder, with a Start menu shortcut and a Settings → Apps entry, without admin', async () => {
  const platform = createFakePlatform(fixture())
  const core = await deploy(platform)
  expect(await platform.readText(INSTALLED_EXE)).toBe(await platform.readText(FAKE_EXE_PATH))
  expect(await platform.readText(SHORTCUT)).toBe(`Shortcut to ${INSTALLED_EXE}`)
  expect(await entry(platform, 'DisplayName')).toBe('Lucent')
  expect(await entry(platform, 'UninstallString')).toBe(`"${INSTALLED_EXE}" --uninstall`)
  expect(await entry(platform, 'DisplayIcon')).toBe(INSTALLED_EXE)
  expect(await entry(platform, 'InstallLocation')).toBe(DATA)
  expect(await entry(platform, 'DisplayVersion')).toMatch(/^\d+\.\d+\.\d+/)
  expect(platform.elevationRequests).toEqual([])
  expect(core.getState().selfInstalled).toBe(true)
  // The downloaded exe stays where the player put it.
  expect(await exists(platform, FAKE_EXE_PATH)).toBe(true)
})

it('adds Lucent to the Start menu as the player before asking for admin access to the game folder', async () => {
  const m = fixture({ readOnlyDirectories: [GAME] })
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  await core.deploy()
  expect(platform.elevationRequests).toHaveLength(1)
  expect(await exists(platform, INSTALLED_EXE)).toBe(true)
  expect(await entry(platform, 'DisplayName')).toBe('Lucent')
  m.elevated = true
  const elevated = createCore(platform)
  await elevated.scan()
  expect(elevated.getState()).toMatchObject({ error: null, activity: { kind: 'done' }, selfInstalled: true })
})

it('keeps working from where it is when the box is unchecked', async () => {
  const platform = createFakePlatform(fixture())
  const core = await deploy(platform, false)
  expect(await exists(platform, INSTALLED_EXE)).toBe(false)
  expect(await exists(platform, SHORTCUT)).toBe(false)
  expect(await entry(platform, 'DisplayName')).toBeNull()
  expect(core.getState().selfInstalled).toBe(false)
  const reopened = createCore(platform)
  await reopened.scan()
  expect(reopened.getState()).toMatchObject({ error: null, activity: { kind: 'deployment' }, deployment: { gameFolder: ROOT } })
})

it('can add Lucent to the Start menu when Reset changes the original choice', async () => {
  const platform = createFakePlatform(fixture())
  const core = await deploy(platform, false)
  expect(await exists(platform, INSTALLED_EXE)).toBe(false)

  await core.resetSetup()
  core.setAddToStartMenu(true)
  await core.review()
  await core.deploy()

  expect(core.getState()).toMatchObject({ error: null, selfInstalled: true, activity: { kind: 'done' } })
  expect(await exists(platform, INSTALLED_EXE)).toBe(true)
  expect(await platform.readText(SHORTCUT)).toBe(`Shortcut to ${INSTALLED_EXE}`)
  expect(await entry(platform, 'DisplayName')).toBe('Lucent')
})

it('shares one data folder between the downloaded copy and the installed copy', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  const portable = await deploy(platform)
  await portable.setEnabled(false)
  m.exePath = INSTALLED_EXE
  const installed = createCore(platform)
  await installed.scan()
  expect(installed.getState()).toMatchObject({ error: null, selfInstalled: true, activity: { kind: 'deployment', enabled: false }, deployment: { gameFolder: ROOT, enabled: false } })
})

it('keeps the Settings → Apps version current when the installed copy opens', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  await deploy(platform)
  await platform.setUninstallEntry('Lucent', { DisplayVersion: '0.0.1' })
  m.exePath = INSTALLED_EXE
  const installed = createCore(platform)
  await installed.scan()
  expect(await entry(platform, 'DisplayVersion')).not.toBe('0.0.1')
  expect(await entry(platform, 'DisplayName')).toBe('Lucent')
})

it('still deploys when Lucent cannot be added to the Start menu, and says so', async () => {
  const platform = createFakePlatform(fixture())
  platform.createShortcut = async () => { throw new PlatformError('access-denied', 'Access is denied.') }
  const core = await deploy(platform)
  expect(core.getState().notice).toMatch(/Start menu.*Access is denied/)
  expect(core.getState().selfInstalled).toBe(false)
  expect(await entry(platform, 'DisplayName')).toBeNull()
})

it('uninstalling from Settings → Apps restores the game folder, then removes the shortcut, the entry, the data folder and the exe', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  const vanilla = await gameFolder(platform)
  await deploy(platform)
  const core = await openFromSettings(m, platform)
  expect(core.getState()).toMatchObject({ busy: false, error: null, appUninstalled: false })
  expect(await exists(platform, INSTALLED_EXE)).toBe(true)
  await core.uninstallApp(true)
  expect(core.getState()).toMatchObject({ busy: false, error: null, appUninstalled: true })
  expect(await gameFolder(platform)).toEqual(vanilla)
  expect(await exists(platform, SHORTCUT)).toBe(false)
  expect(await entry(platform, 'DisplayName')).toBeNull()
  expect(await exists(platform, INSTALLED_EXE)).toBe(false)
  expect(await exists(platform, DATA)).toBe(false)
  expect(platform.removedOnExit).toEqual([DATA])
})

it('leaves the game folder alone when "Restore the game folder" is unchecked', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  await deploy(platform)
  const deployed = await gameFolder(platform)
  const core = await openFromSettings(m, platform)
  await core.uninstallApp(false)
  expect(core.getState()).toMatchObject({ error: null, appUninstalled: true })
  expect(await gameFolder(platform)).toEqual(deployed)
  expect(await exists(platform, SHORTCUT)).toBe(false)
  expect(await entry(platform, 'DisplayName')).toBeNull()
  expect(await exists(platform, DATA)).toBe(false)
})

it('refuses to restore the game folder while XIV runs, and removes nothing', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  await deploy(platform)
  const deployed = await gameFolder(platform)
  const core = await openFromSettings(m, platform)
  m.gameRunning = true
  await core.uninstallApp(true)
  expect(core.getState()).toMatchObject({ busy: false, error: expect.stringMatching(/Close XIV/), appUninstalled: false })
  expect(await gameFolder(platform)).toEqual(deployed)
  expect(await exists(platform, SHORTCUT)).toBe(true)
  expect(await entry(platform, 'DisplayName')).toBe('Lucent')
  expect(await exists(platform, INSTALLED_EXE)).toBe(true)
  expect(platform.removedOnExit).toBeNull()
})

it('keeps the data folder and its backups when restoring the game folder fails', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  await deploy(platform)
  const core = await openFromSettings(m, platform)
  const removeFile = platform.removeFile.bind(platform)
  platform.removeFile = async (path) => {
    if (path.toLowerCase().startsWith(GAME.toLowerCase())) throw new PlatformError('locked', `In use: ${path}`, path)
    return removeFile(path)
  }
  await core.uninstallApp(true)
  expect(core.getState()).toMatchObject({ busy: false, appUninstalled: false })
  expect(core.getState().error).toMatch(/in use.*Recovery could not finish/i)
  expect(await exists(platform, `${DATA}\\deployments`)).toBe(true)
  expect(await exists(platform, SHORTCUT)).toBe(true)
  expect(await entry(platform, 'DisplayName')).toBe('Lucent')
  expect(platform.removedOnExit).toBeNull()
})

it('continues uninstalling from Settings → Apps after admin access to the game folder', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  const vanilla = await gameFolder(platform)
  await deploy(platform)
  m.readOnlyDirectories = [GAME]
  const core = await openFromSettings(m, platform)
  await core.uninstallApp(true)
  expect(platform.elevationRequests).toHaveLength(1)
  expect(core.getState().appUninstalled).toBe(false)
  expect(await exists(platform, SHORTCUT)).toBe(true)
  m.elevated = true
  const elevated = await openFromSettings(m, platform)
  expect(elevated.getState()).toMatchObject({ busy: false, error: null, appUninstalled: true })
  expect(await gameFolder(platform)).toEqual(vanilla)
  expect(await exists(platform, SHORTCUT)).toBe(false)
  expect(await entry(platform, 'DisplayName')).toBeNull()
  expect(await exists(platform, DATA)).toBe(false)
  expect(platform.elevationRequests).toHaveLength(1)
})

it('names the folder to delete by hand when Lucent cannot remove it on exit', async () => {
  const m = fixture()
  const platform = createFakePlatform(m)
  await deploy(platform)
  const core = await openFromSettings(m, platform)
  platform.exitAndRemove = async () => { throw new PlatformError('unknown', 'Refusing to remove this folder.') }
  await core.uninstallApp(false)
  expect(core.getState()).toMatchObject({ busy: false, appUninstalled: false })
  expect(core.getState().error).toContain(`Delete ${DATA} yourself`)
  expect(await exists(platform, SHORTCUT)).toBe(false)
  expect(await entry(platform, 'DisplayName')).toBeNull()
})
