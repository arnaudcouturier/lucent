import { describe, expect, it } from 'vitest'
import { createCore } from './core'
import { createFakePlatform, FAKE_EXE_PATH, type FakePlatform, type Machine } from '../platform/fake'
import { fixtureContentHost, graphicsCard, machine, nextContentHost, vanillaGame, xivLauncher } from '../platform/fixtures'
import { DEFAULT_ENV } from '../platform/fake'
import { runHeadless } from './autoRepair'
import { dataPaths, readDeployment } from './deployment'

const ROOT = 'C:\\Games\\XIV'
const GAME = `${ROOT}\\game`
const PATCH = '2026.10.20.0000.0000'
const CONFIG = `${DEFAULT_ENV.AppData}\\XIVLauncher\\launcherConfigV3.json`

const otherAddon = { IsEnabled: true, Addon: { Path: 'C:\\Tools\\ACT\\Advanced Combat Tracker.exe', CommandLine: '', RunAsAdmin: false, RunOnClose: false, KillAfterClose: true } }

const INSTALLED_EXE = `${DEFAULT_ENV.LocalAppData}\\Lucent\\Lucent.exe`

async function deployed({ addToStartMenu = true } = {}) {
  const m = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT), xivLauncher(ROOT))
  const platform = createFakePlatform(m)
  const core = createCore(platform)
  await core.scan()
  await core.review()
  core.setAddToStartMenu(addToStartMenu)
  await core.deploy()
  core.finish()
  return { m, platform, core }
}

async function config(platform: FakePlatform) {
  return JSON.parse(await platform.readText(CONFIG)) as Record<string, string>
}
const addons = async (platform: FakePlatform) => JSON.parse((await config(platform)).AddonList) as typeof otherAddon[]

describe('the XIVLauncher auto-repair switch', () => {
  it('is off by default and only offered when XIVLauncher was found', async () => {
    const { core } = await deployed()
    expect(core.getState().xivLauncher).toMatchObject({ status: 'found', autoRepair: false })
    const without = createCore(createFakePlatform(machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT))))
    await without.scan()
    expect(without.getState().xivLauncher).toEqual({ status: 'not-found' })
  })

  it('turning it on adds a check on launch and a repair on close, keeping the other add-ons and settings', async () => {
    const { platform, core } = await deployed()
    const before = await config(platform)
    await platform.writeText(CONFIG, JSON.stringify({ ...before, AddonList: JSON.stringify([otherAddon]), Unknown: 'kept' }, null, 2))
    await core.setAutoRepair(true)
    expect(core.getState().error).toBeNull()
    expect(core.getState().xivLauncher).toMatchObject({ status: 'found', autoRepair: true })
    const after = await config(platform)
    expect(after).toMatchObject({ GamePath: ROOT, Unknown: 'kept' })
    expect(await addons(platform)).toEqual([
      otherAddon,
      { IsEnabled: true, Addon: { Path: INSTALLED_EXE, CommandLine: '--headless-check', RunAsAdmin: false, RunOnClose: false, KillAfterClose: false } },
      { IsEnabled: true, Addon: { Path: INSTALLED_EXE, CommandLine: '--headless-repair', RunAsAdmin: false, RunOnClose: true, KillAfterClose: false } },
    ])
    // Reopening reads the switch back from XIVLauncher's own list.
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState().xivLauncher).toMatchObject({ autoRepair: true })
  })

  it('points the entries at the running exe when Lucent stays portable', async () => {
    const { platform, core } = await deployed({ addToStartMenu: false })
    await core.setAutoRepair(true)
    expect((await addons(platform)).map((a) => a.Addon.Path)).toEqual([FAKE_EXE_PATH, FAKE_EXE_PATH])
  })

  it('turning it off removes both entries and leaves the other add-ons untouched', async () => {
    const { platform, core } = await deployed()
    await platform.writeText(CONFIG, JSON.stringify({ ...await config(platform), AddonList: JSON.stringify([otherAddon]) }, null, 2))
    await core.setAutoRepair(true)
    await core.setAutoRepair(false)
    expect(core.getState().error).toBeNull()
    expect(core.getState().xivLauncher).toMatchObject({ autoRepair: false })
    expect(await addons(platform)).toEqual([otherAddon])
  })

  it('turning it on again replaces Lucent’s entries rather than duplicating them', async () => {
    const { platform, core } = await deployed()
    await core.setAutoRepair(true)
    await core.setAutoRepair(true)
    expect((await addons(platform)).map((a) => a.Addon.CommandLine)).toEqual(['--headless-check', '--headless-repair'])
  })

  it('reads as off when the player disabled Lucent’s entries in XIVLauncher, and turning it on enables them again', async () => {
    const { platform, core } = await deployed()
    await core.setAutoRepair(true)
    const disabled = (await addons(platform)).map((a) => ({ ...a, IsEnabled: false }))
    await platform.writeText(CONFIG, JSON.stringify({ ...await config(platform), AddonList: JSON.stringify(disabled) }, null, 2))
    const reopened = createCore(platform)
    await reopened.scan()
    expect(reopened.getState().xivLauncher).toMatchObject({ autoRepair: false })
    await reopened.setAutoRepair(true)
    expect((await addons(platform)).map((a) => a.IsEnabled)).toEqual([true, true])
  })

  it('sets RunAsAdmin on both entries when the game folder needs administrator access', async () => {
    const { m, platform, core } = await deployed()
    m.readOnlyDirectories = [GAME]
    await core.setAutoRepair(true)
    expect(core.getState().error).toBeNull()
    expect((await addons(platform)).map((a) => a.Addon.RunAsAdmin)).toEqual([true, true])
  })

  it('refuses to edit XIVLauncher’s config while XIVLauncher runs, and asks the player to close it', async () => {
    const { m, platform, core } = await deployed()
    const before = await platform.readText(CONFIG)
    m.processes = ['XIVLauncher.exe']
    await core.setAutoRepair(true)
    expect(core.getState().error).toMatch(/Close XIVLauncher/)
    expect(core.getState().xivLauncher).toMatchObject({ autoRepair: false })
    expect(await platform.readText(CONFIG)).toBe(before)
  })

  it('never rewrites an add-on list it cannot read', async () => {
    const { platform, core } = await deployed()
    const damaged = JSON.stringify({ ...await config(platform), AddonList: '[{' }, null, 2)
    await platform.writeText(CONFIG, damaged)
    await core.setAutoRepair(true)
    expect(core.getState().error).toMatch(/add-on list/)
    expect(await platform.readText(CONFIG)).toBe(damaged)
  })
})

describe('the headless check when the game launches', () => {
  it('notifies that Lucent will repair on close when it finds drift, and changes nothing', async () => {
    const { m, platform } = await deployed()
    await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
    await platform.writeText(`${GAME}\\ffxivgame.ver`, PATCH)
    m.gameRunning = true
    expect(await runHeadless(platform, 'check')).toMatchObject({ kind: 'drift' })
    expect(platform.notifications).toEqual([{ title: expect.any(String), body: 'Lucent will repair when you close the game.' }])
    expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('Patched')
  })

  it('stays silent when the deployment is healthy', async () => {
    const { m, platform } = await deployed()
    m.gameRunning = true
    expect(await runHeadless(platform, 'check')).toEqual({ kind: 'healthy' })
    expect(platform.notifications).toEqual([])
  })

  it('stays silent when XIVLauncher’s game folder has no deployment', async () => {
    const platform = createFakePlatform(machine(vanillaGame(ROOT), xivLauncher(ROOT)))
    expect(await runHeadless(platform, 'check')).toEqual({ kind: 'no-deployment' })
    expect(platform.notifications).toEqual([])
  })
})

describe('the headless repair after the game closes', () => {
  it('repairs drift and notifies that the game is repaired', async () => {
    const { platform } = await deployed()
    await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
    await platform.writeText(`${GAME}\\ffxivgame.ver`, PATCH)
    expect(await runHeadless(platform, 'repair')).toEqual({ kind: 'repaired' })
    expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('OptiScaler')
    expect(platform.notifications).toHaveLength(1)
    expect(platform.notifications[0].title).toMatch(/repaired/i)
    expect((await readDeployment(platform, ROOT))?.gameVersion).toBe(PATCH)
  })

  it('stays silent when there is nothing to repair', async () => {
    const { platform } = await deployed()
    expect(await runHeadless(platform, 'repair')).toEqual({ kind: 'healthy' })
    expect(platform.notifications).toEqual([])
  })

  it('never runs an update, even when a newer content version is published', async () => {
    const { m, platform } = await deployed()
    Object.assign(m.remoteText!, nextContentHost().remoteText)
    const record = await readDeployment(platform, ROOT)
    await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
    await runHeadless(platform, 'repair')
    expect((await readDeployment(platform, ROOT))?.contentVersion).toBe(record?.contentVersion)
  })

  it('notifies the failure, with the game folder unchanged, when the repair cannot finish', async () => {
    const { m, platform } = await deployed()
    await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
    // Neither the cache nor the content host can supply the file.
    const { cache } = await dataPaths(platform, ROOT)
    for (const file of await platform.listFiles(cache)) await platform.removeFile(`${cache}\\${file}`)
    m.remoteText = {}
    expect(await runHeadless(platform, 'repair')).toMatchObject({ kind: 'failed' })
    expect(platform.notifications).toHaveLength(1)
    expect(platform.notifications[0].body).toMatch(/Open Lucent/)
    expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('Patched')
  })

  it('leaves the repair to Lucent’s window when the game folder needs administrator access it doesn’t have', async () => {
    const { m, platform } = await deployed()
    await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
    m.readOnlyDirectories = [GAME]
    expect(await runHeadless(platform, 'repair')).toMatchObject({ kind: 'failed' })
    expect(platform.elevationRequests).toEqual([])
    expect(platform.notifications[0].body).toMatch(/Open Lucent/)
    expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('Patched')
  })

  it('waits for the next close when the game is still running', async () => {
    const { m, platform } = await deployed()
    await platform.writeText(`${GAME}\\winmm.dll`, 'Patched')
    m.gameRunning = true
    expect(await runHeadless(platform, 'repair')).toMatchObject({ kind: 'failed' })
    expect(await platform.readText(`${GAME}\\winmm.dll`)).toBe('Patched')
  })
})

describe('uninstalling Lucent from Settings → Apps', () => {
  const uninstall = async (m: Machine, platform: FakePlatform, restore: boolean) => {
    m.exePath = INSTALLED_EXE
    const core = createCore(platform)
    await core.uninstallApp(restore)
    return core
  }

  it('removes only Lucent’s XIVLauncher add-ons, whether or not the game folder is restored', async () => {
    for (const restore of [true, false]) {
      const { m, platform, core } = await deployed()
      await platform.writeText(CONFIG, JSON.stringify({ ...await config(platform), AddonList: JSON.stringify([otherAddon]), Other: 1 }, null, 2))
      await core.setAutoRepair(true)
      expect(await addons(platform)).toHaveLength(3)
      const after = await uninstall(m, platform, restore)
      expect(after.getState()).toMatchObject({ error: null, notice: null, appUninstalled: true })
      expect(await addons(platform)).toEqual([otherAddon])
      expect(await config(platform)).toMatchObject({ GamePath: ROOT, Other: 1 })
    }
  })

  it('does nothing without XIVLauncher or without Lucent’s add-ons', async () => {
    const without = machine(fixtureContentHost(), graphicsCard(), vanillaGame(ROOT))
    const bare = await uninstall(without, createFakePlatform(without), false)
    expect(bare.getState()).toMatchObject({ error: null, notice: null, appUninstalled: true })
    const { m, platform } = await deployed()
    const before = await platform.readText(CONFIG)
    expect((await uninstall(m, platform, false)).getState()).toMatchObject({ error: null, notice: null, appUninstalled: true })
    expect(await platform.readText(CONFIG)).toBe(before)
  })

  it('finishes while XIVLauncher runs, leaves its config alone and says where to remove the add-ons', async () => {
    const { m, platform, core } = await deployed()
    await core.setAutoRepair(true)
    const before = await platform.readText(CONFIG)
    m.processes = ['XIVLauncher.exe']
    const after = await uninstall(m, platform, true)
    expect(after.getState()).toMatchObject({ error: null, appUninstalled: true, notice: expect.stringMatching(/XIVLauncher was running.*Addons/) })
    expect(await platform.readText(CONFIG)).toBe(before)
  })
})
