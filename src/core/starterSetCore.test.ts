import { describe, expect, it } from 'vitest'
import manifest from '../../manifest.json'
import { OFFICIAL_REPO_URL } from '../shared/starterSet'
import { DEFAULT_ENV, createFakePlatform, fakeZip, type Machine } from '../platform/fake'
import { graphicsCard, machine, manifestHost, steam, steamGameFolder, vanillaGame } from '../platform/fixtures'
import { createCore } from './core'

const XL = `${DEFAULT_ENV.AppData}\\XIVLauncher`
const SEA = manifest.starterSet.repos[0].url
const config = JSON.stringify({ ThirdRepoList: { $type: 'List`1[[Dalamud.Configuration.ThirdPartyRepoSettings, Dalamud]], X', $values: [] } })
const dalamud: Machine = {
  files: { [`${XL}\\launcherConfigV3.json`]: JSON.stringify({ InGameAddonEnabled: 'true' }), [`${XL}\\dalamudConfig.json`]: config },
  directories: [`${XL}\\addon\\Hooks\\15.0.3.7`],
  remoteText: {
    [OFFICIAL_REPO_URL]: JSON.stringify([{ InternalName: 'Weatherman', AssemblyVersion: '2.5.0.6', DalamudApiLevel: 15, DownloadLinkInstall: 'https://downloads.test/Weatherman.zip' }]),
    'https://downloads.test/Weatherman.zip': fakeZip({ 'Weatherman.dll': 'code', 'Weatherman.json': JSON.stringify({ InternalName: 'Weatherman', AssemblyVersion: '2.5.0.6' }) }),
  },
}
const game = [graphicsCard(), steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary' }), vanillaGame(steamGameFolder('D:\\SteamLibrary'))]
const coreOn = (...parts: Machine[]) => {
  const platform = createFakePlatform(machine(manifestHost(), ...game, ...parts))
  return { platform, core: createCore(platform) }
}

describe('the Mods section’s state', () => {
  it('waits for the manifest', async () => {
    const { core } = coreOn(dalamud)
    await core.refreshStarterSet()
    expect(core.getState().starterSet).toEqual({ status: 'idle' })
  })

  it('reads the Starter set and what this PC has once the manifest is in', async () => {
    const { core } = coreOn(dalamud, { files: { [`${XL}\\installedPlugins\\Penumbra\\1.7.2.1\\Penumbra.dll`]: 'dll' } })
    await core.scan()
    await core.refreshStarterSet()
    const { starterSet } = core.getState()
    expect(starterSet.status).toBe('ready')
    if (starterSet.status !== 'ready') return
    expect(starterSet.set.plugins).toHaveLength(8)
    expect(starterSet.scan.dalamud).toEqual({ status: 'ready' })
    expect(starterSet.scan.installedPlugins).toEqual(['Penumbra'])
    expect(starterSet.result).toBeNull()
  })

  it('works without a deployment or a game folder', async () => {
    const platform = createFakePlatform(machine(manifestHost(), graphicsCard(), dalamud))
    const core = createCore(platform)
    await core.scan()
    await core.refreshStarterSet()
    expect(core.getState().deployment).toBeNull()
    expect(core.getState().starterSet.status).toBe('ready')
  })

  it('is unavailable, with the reason, when the manifest has no Starter set', async () => {
    const platform = createFakePlatform(machine(manifestHost({ ...manifest, starterSet: undefined }), ...game, dalamud))
    const core = createCore(platform)
    await core.scan()
    await core.refreshStarterSet()
    expect(core.getState().starterSet).toEqual({ status: 'unavailable', message: 'This manifest has no Starter set yet.' })
  })

  it('is unavailable when the set is invalid, while DLSS content stays usable', async () => {
    const platform = createFakePlatform(machine(manifestHost({ ...manifest, starterSet: { repos: 'oops' } }), ...game, dalamud))
    const core = createCore(platform)
    await core.scan()
    await core.refreshStarterSet()
    const { starterSet, manifest: loaded } = core.getState()
    expect(starterSet).toMatchObject({ status: 'unavailable', message: expect.stringMatching(/has a mistake/) })
    expect(loaded.status).toBe('ready')
    expect(core.getState().graphics.status).toBe('found')
  })

  it('is unavailable when the manifest could not be loaded', async () => {
    const platform = createFakePlatform(machine(...game))
    const core = createCore(platform)
    await core.scan()
    await core.refreshStarterSet()
    expect(core.getState().starterSet).toMatchObject({ status: 'unavailable', message: expect.stringMatching(/couldn’t load its manifest/) })
  })

  it('reports Dalamud not being ready as part of the reading, not as a failure', async () => {
    const { core } = coreOn()
    await core.scan()
    await core.refreshStarterSet()
    const { starterSet } = core.getState()
    expect(starterSet.status === 'ready' && starterSet.scan.dalamud).toEqual({ status: 'no-xivlauncher' })
  })
})

describe('adding plugins', () => {
  it('places the plugin, reports it, and reads the machine again', async () => {
    const { core, platform } = coreOn(dalamud)
    await core.scan()
    await core.refreshStarterSet()
    await core.addPlugins(['Weatherman'])
    const state = core.getState()
    expect(state.error).toBeNull()
    expect(state.busy).toBe(false)
    expect(state.starterSet).toMatchObject({ status: 'ready', progress: null, result: { placed: [{ name: 'Weatherman', version: '2.5.0.6' }], skipped: [], reposAdded: [] } })
    expect(state.starterSet.status === 'ready' && state.starterSet.scan.installedPlugins).toEqual(['Weatherman'])
    expect(await platform.readText(`${XL}\\installedPlugins\\Weatherman\\2.5.0.6\\Weatherman.dll`)).toBe('code')
  })

  it('adds a third-party repo for a plugin that needs one, and says so', async () => {
    const { core, platform } = coreOn(dalamud, { remoteText: {
      [SEA]: JSON.stringify([{ InternalName: 'Penumbra', AssemblyVersion: '1.7.2.1', DalamudApiLevel: 15, DownloadLinkInstall: 'https://downloads.test/Penumbra.zip' }]),
      'https://downloads.test/Penumbra.zip': fakeZip({ 'Penumbra.dll': 'code', 'Penumbra.json': JSON.stringify({ InternalName: 'Penumbra', AssemblyVersion: '1.7.2.1' }) }),
    } })
    await core.scan()
    await core.refreshStarterSet()
    await core.addPlugins(['Penumbra'])
    const { starterSet } = core.getState()
    expect(starterSet.status === 'ready' && starterSet.result?.reposAdded).toEqual([SEA])
    expect(JSON.parse(await platform.readText(`${XL}\\dalamudConfig.json`)).ThirdRepoList.$values).toEqual([
      { $type: 'Dalamud.Configuration.ThirdPartyRepoSettings, Dalamud', Url: SEA, IsEnabled: true },
    ])
  })

  it('shows the reason and changes nothing while XIV runs', async () => {
    const { core, platform } = coreOn(dalamud, { gameRunning: true })
    await core.scan()
    await core.refreshStarterSet()
    await core.addPlugins(['Weatherman'])
    expect(core.getState().error).toMatch(/Close XIV/)
    expect(core.getState().busy).toBe(false)
    await expect(platform.stat(`${XL}\\installedPlugins\\Weatherman`)).rejects.toMatchObject({ kind: 'not-found' })
  })

  it('shows the reason while XIVLauncher runs', async () => {
    const { core } = coreOn(dalamud, { processes: ['XIVLauncher.exe'] })
    await core.scan()
    await core.refreshStarterSet()
    await core.addPlugins(['Weatherman'])
    expect(core.getState().error).toMatch(/Close XIVLauncher/)
  })

  it('does nothing before the Starter set is read, or for names it does not have', async () => {
    const { core } = coreOn(dalamud)
    await core.addPlugins(['Weatherman'])
    await core.scan()
    await core.refreshStarterSet()
    await core.addPlugins(['NoSuchPlugin'])
    expect(core.getState().error).toBeNull()
    const { starterSet } = core.getState()
    expect(starterSet.status === 'ready' && starterSet.result).toBeNull()
  })

  it('runs one Add at a time', async () => {
    const { core } = coreOn(dalamud)
    await core.scan()
    await core.refreshStarterSet()
    await Promise.all([core.addPlugins(['Weatherman']), core.addPlugins(['Weatherman'])])
    const state = core.getState()
    expect(state.error).toBeNull()
    expect(state.starterSet.status === 'ready' && state.starterSet.result?.placed).toEqual([{ name: 'Weatherman', version: '2.5.0.6' }])
  })

  it('logs what it adds in the activity log', async () => {
    const { core, platform } = coreOn(dalamud)
    await core.scan()
    await core.refreshStarterSet()
    await core.addPlugins(['Weatherman'])
    const log = await platform.readText(`${DEFAULT_ENV.LocalAppData}\\Lucent\\lucent.log`)
    expect(log).toContain('Starter set: adding Weatherman')
    expect(log).toContain('Starter set: added Weatherman 2.5.0.6 from Dalamud’s repository')
  })

  it('keeps the last result across a refresh, until the next Add', async () => {
    const { core } = coreOn(dalamud)
    await core.scan()
    await core.refreshStarterSet()
    await core.addPlugins(['Weatherman'])
    await core.refreshStarterSet()
    const { starterSet } = core.getState()
    expect(starterSet.status === 'ready' && starterSet.result?.placed).toHaveLength(1)
  })

  it('opens a mod’s Heliosphere page through the usual link command', async () => {
    const { core, platform } = coreOn(dalamud)
    await core.scan()
    await core.openLink('https://heliosphere.app/mod/am6y77mg6h1cn8agg7kqna6emc')
    expect(platform.openedUrls).toEqual(['https://heliosphere.app/mod/am6y77mg6h1cn8agg7kqna6emc'])
  })
})
