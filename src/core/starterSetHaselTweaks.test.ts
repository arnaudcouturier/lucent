import { describe, expect, it } from 'vitest'
import manifest from '../../manifest.json'
import { DEFAULT_ENV, createFakePlatform, fakeZip, type Machine } from '../platform/fake'
import { graphicsCard, machine, manifestHost, steam, steamGameFolder, vanillaGame } from '../platform/fixtures'
import { createCore } from './core'

// HaselTweaks as the repository's own Starter set lists it, against a fake Dalamud and a fake copy of the author's repository
// (the entry's fields and the zip's layout are the real ones, read from the author's repo.json and release on 2026-10-26).
const XL = `${DEFAULT_ENV.AppData}\\XIVLauncher`
const REPO = manifest.starterSet.repos.find((r) => r.id === 'haselnussbomber')!
const LINK = 'https://github.com/Haselnussbomber/HaselTweaks/releases/download/v50.0.2/latest.zip'
const THIRD_PARTY_TYPE = 'Dalamud.Configuration.ThirdPartyRepoSettings, Dalamud'
const list = (...entries: object[]) => JSON.stringify({ ThirdRepoList: { $type: 'List`1[[Dalamud.Configuration.ThirdPartyRepoSettings, Dalamud]], X', $values: entries } })
const dalamud = (config: string): Machine => ({
  files: { [`${XL}\\launcherConfigV3.json`]: JSON.stringify({ InGameAddonEnabled: 'true' }), [`${XL}\\dalamudConfig.json`]: config },
  directories: [`${XL}\\addon\\Hooks\\15.0.3.7`],
  remoteText: {
    [REPO.url]: JSON.stringify([
      { InternalName: 'HaselDebug', AssemblyVersion: '3.0.0.0', DalamudApiLevel: 15, DownloadLinkInstall: 'https://downloads.test/HaselDebug.zip' },
      { InternalName: 'HaselTweaks', AssemblyVersion: '50.0.2.0', DalamudApiLevel: 15, DownloadLinkInstall: LINK },
    ]),
    [LINK]: fakeZip({
      'HaselTweaks.dll': 'code', 'HaselTweaks.json': JSON.stringify({ InternalName: 'HaselTweaks', AssemblyVersion: '50.0.2.0', DalamudApiLevel: 15 }),
      'HaselCommon.dll': 'common', 'FFXIVClientStructs.dll': 'structs', 'runtimes/win/lib/net10.0/System.Diagnostics.EventLog.dll': 'runtime',
    }),
  },
})
const game = [graphicsCard(), steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary' }), vanillaGame(steamGameFolder('D:\\SteamLibrary'))]
const coreOn = (...parts: Machine[]) => {
  const platform = createFakePlatform(machine(manifestHost(), ...game, ...parts))
  return { platform, core: createCore(platform) }
}

describe('HaselTweaks in the Starter set', () => {
  it('is an optional extra from the author’s own repository, which is a third-party repo and names its author', () => {
    const plugin = manifest.starterSet.plugins.find((p) => p.internalName === 'HaselTweaks')!
    expect(plugin).toMatchObject({ name: 'HaselTweaks', author: 'Haselnussbomber', group: 'extra', repo: 'haselnussbomber' })
    expect(plugin.setup).toMatch(/\/haseltweaks/)
    expect(REPO).toEqual({ id: 'haselnussbomber', label: 'MyDalamudPlugins', author: 'Haselnussbomber', url: 'https://raw.githubusercontent.com/Haselnussbomber/MyDalamudPlugins/main/repo.json' })
  })

  it('adds the author’s repository with its exact address and places the plugin with every file of its zip', async () => {
    const { core, platform } = coreOn(dalamud(list()))
    await core.scan()
    await core.refreshStarterSet()
    await core.addPlugins(['HaselTweaks'])
    const { starterSet, error } = core.getState()
    expect(error).toBeNull()
    expect(starterSet.status === 'ready' && starterSet.result).toMatchObject({ placed: [{ name: 'HaselTweaks', version: '50.0.2.0' }], skipped: [], reposAdded: [REPO.url] })
    expect(JSON.parse(await platform.readText(`${XL}\\dalamudConfig.json`)).ThirdRepoList.$values).toEqual([{ $type: THIRD_PARTY_TYPE, Url: REPO.url, IsEnabled: true }])
    const dir = `${XL}\\installedPlugins\\HaselTweaks\\50.0.2.0`
    expect(await platform.readText(`${dir}\\HaselTweaks.dll`)).toBe('code')
    expect(await platform.readText(`${dir}\\FFXIVClientStructs.dll`)).toBe('structs')
    expect(await platform.readText(`${dir}\\runtimes\\win\\lib\\net10.0\\System.Diagnostics.EventLog.dll`)).toBe('runtime')
    // Dalamud loads a third-party plugin only when its manifest names the repo exactly as the config lists it.
    expect(JSON.parse(await platform.readText(`${dir}\\HaselTweaks.json`)).InstalledFromUrl).toBe(REPO.url)
    expect(starterSet.status === 'ready' && starterSet.scan.installedPlugins).toEqual(['HaselTweaks'])
  })

  it('leaves the author’s repository entry alone when the player already has it, and places the plugin', async () => {
    const entry = { $type: THIRD_PARTY_TYPE, Url: REPO.url, IsEnabled: true }
    const { core, platform } = coreOn(dalamud(list(entry)))
    await core.scan()
    await core.refreshStarterSet()
    await core.addPlugins(['HaselTweaks'])
    const { starterSet } = core.getState()
    expect(starterSet.status === 'ready' && starterSet.result).toMatchObject({ placed: [{ name: 'HaselTweaks' }], reposAdded: [] })
    expect(JSON.parse(await platform.readText(`${XL}\\dalamudConfig.json`)).ThirdRepoList.$values).toEqual([entry])
  })

  it('skips it, with a reason, and writes nothing when the player switched the repository off', async () => {
    const { core, platform } = coreOn(dalamud(list({ $type: THIRD_PARTY_TYPE, Url: REPO.url, IsEnabled: false })))
    await core.scan()
    await core.refreshStarterSet()
    await core.addPlugins(['HaselTweaks'])
    const { starterSet } = core.getState()
    expect(starterSet.status === 'ready' && starterSet.result?.placed).toEqual([])
    expect(starterSet.status === 'ready' && starterSet.result?.skipped).toEqual([expect.objectContaining({ name: 'HaselTweaks', reason: expect.stringMatching(/turned off|switched off|disabled/i) })])
    expect(await platform.listFiles(`${XL}\\installedPlugins`).catch(() => [])).toEqual([])
  })
})
