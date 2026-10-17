import { describe, expect, it } from 'vitest'
import manifest from '../../manifest.json'
import { parseManifest } from '../shared/manifest'
import { OFFICIAL_REPO_URL, type StarterPlugin, type StarterSet } from '../shared/starterSet'
import { DEFAULT_ENV, createFakePlatform, fakeZip, type FakePlatform, type Machine } from '../platform/fake'
import type { Platform } from './platform'
import { PlatformError } from './platform'
import {
  DalamudConfigError, STAGING_FOLDER, addThirdRepos, closedGuard, dalamudMessage, modInstalled, pluginStatus, pluginsToAdd, readThirdRepos,
  reposToAdd, scanStarterSet, seedPlugins, type SeedOptions, type StarterSetScan,
} from './starterSet'

const SET: StarterSet = parseManifest(JSON.stringify(manifest)).starterSet!
const plugin = (name: string) => SET.plugins.find((p) => p.internalName === name)!
const XL = `${DEFAULT_ENV.AppData}\\XIVLauncher`
const PLUGINS = `${XL}\\installedPlugins`
const CONFIG = `${XL}\\dalamudConfig.json`
const STAGING = `${DEFAULT_ENV.LocalAppData}\\Lucent\\${STAGING_FOLDER}`
const SEA = SET.repos.find((r) => r.id === 'seaofstars')!.url
const ATR = SET.repos.find((r) => r.id === 'action-timeline-replacement')!.url

const TYPE = 'System.Collections.Generic.List`1[[Dalamud.Configuration.ThirdPartyRepoSettings, Dalamud]], System.Private.CoreLib'
const ENTRY_TYPE = 'Dalamud.Configuration.ThirdPartyRepoSettings, Dalamud'

/** Dalamud's config as Newtonsoft writes it, with a number a double can't hold and keys a reparse would reorder. */
function dalamudConfig(repos: { url: string; enabled?: boolean }[], options: { newline?: string; bom?: boolean; compact?: boolean } = {}): string {
  const nl = options.newline ?? '\n'
  const entry = (r: { url: string; enabled?: boolean }) =>
    `      {${nl}        "$type": "${ENTRY_TYPE}",${nl}        "Url": "${r.url}",${nl}        "IsEnabled": ${r.enabled === false ? 'false' : 'true'}${nl}      }`
  const values = repos.length ? `[${nl}${repos.map(entry).join(`,${nl}`)}${nl}    ]` : '[]'
  const text = [
    '{', '  "DoPluginTest": false,', '  "LastContentId": 9007199254740993,', '  "Note": "ThirdRepoList \\" { [ ] }",',
    '  "Numbered": {', '    "10": "ten",', '    "2": "two"', '  },',
    '  "ThirdRepoList": {', `    "$type": "${TYPE}",`, `    "$values": ${values}`, '  },',
    '  "ThirdRepoSpeedbumpDismissed": true', '}', '',
  ].join(nl)
  const result = options.compact ? JSON.stringify(JSON.parse(text)) : text
  return (options.bom ? '\uFEFF' : '') + result
}

describe('addThirdRepos', () => {
  it('appends in the shape the file uses and leaves every other byte alone', () => {
    const before = dalamudConfig([{ url: SEA }])
    const { text, added } = addThirdRepos(before, [ATR])
    expect(added).toEqual([ATR])
    expect(readThirdRepos(text)).toEqual([{ url: SEA, enabled: true }, { url: ATR, enabled: true }])
    expect(text).toContain(`      },\n      {\n        "$type": "${ENTRY_TYPE}",\n        "Url": "${ATR}",\n        "IsEnabled": true\n      }\n    ]`)
    // Outside the list nothing moved: the big number, the numeric keys and the quoted text are exactly as they were.
    const cut = (s: string) => ({ head: s.slice(0, s.indexOf('"ThirdRepoList"')), tail: s.slice(s.indexOf('"ThirdRepoSpeedbumpDismissed"')) })
    expect(cut(text)).toEqual(cut(before))
    expect(text).toContain('9007199254740993')
  })

  it('writes an entry into an empty list, taking its type from the list', () => {
    const { text } = addThirdRepos(dalamudConfig([]), [SEA])
    expect(readThirdRepos(text)).toEqual([{ url: SEA, enabled: true }])
    expect(text).toContain(`"$type": "${ENTRY_TYPE}"`)
    expect(text).toContain('    "$values": [\n      {')
  })

  it('appends several at once, once each', () => {
    const { text, added } = addThirdRepos(dalamudConfig([]), [SEA, ATR, SEA])
    expect(added).toEqual([SEA, ATR])
    expect(readThirdRepos(text).map((r) => r.url)).toEqual([SEA, ATR])
  })

  it('keeps CRLF line endings and a byte-order mark', () => {
    const before = dalamudConfig([{ url: SEA }], { newline: '\r\n', bom: true })
    const { text } = addThirdRepos(before, [ATR])
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    expect(text).toContain(`${ATR}`)
    expect(readThirdRepos(text).map((r) => r.url)).toEqual([SEA, ATR])
  })

  it('handles a config written on one line', () => {
    const { text } = addThirdRepos(dalamudConfig([{ url: SEA }], { compact: true }), [ATR])
    expect(readThirdRepos(text).map((r) => r.url)).toEqual([SEA, ATR])
    expect(text).not.toContain('\n')
  })

  it('compares addresses by exact string', () => {
    const upper = SEA.replace('SeaOfStars', 'seaofstars')
    expect(addThirdRepos(dalamudConfig([{ url: SEA }]), [SEA]).added).toEqual([])
    expect(addThirdRepos(dalamudConfig([{ url: SEA }]), [upper]).added).toEqual([upper])
  })

  it('returns the text untouched when every address is listed, even a disabled one', () => {
    const before = dalamudConfig([{ url: SEA, enabled: false }])
    expect(addThirdRepos(before, [SEA])).toEqual({ text: before, added: [] })
  })

  it('is not fooled by list-looking text inside other values', () => {
    const { text } = addThirdRepos(dalamudConfig([{ url: SEA }]), [ATR])
    expect(JSON.parse(text).Note).toBe('ThirdRepoList " { [ ] }')
  })

  it.each([
    ['a config with no list of repositories', JSON.stringify({ DoPluginTest: false })],
    ['a list written as a plain array', JSON.stringify({ ThirdRepoList: [] })],
    ['a list with no values', JSON.stringify({ ThirdRepoList: { $type: TYPE } })],
    ['text that is not JSON', 'not json'],
    ['a list of entries with no type to copy', JSON.stringify({ ThirdRepoList: { $values: [] } })],
  ])('refuses %s', (_name, config) => {
    expect(() => addThirdRepos(config, [SEA])).toThrow(DalamudConfigError)
  })
})

// ------------------------------------------------------------------------------------------------------------------

const heliosphereZipUrl = 'https://repo.heliosphere.app/latest.zip'
const pluginZip = (name: string, version = '1.0.0.0', overrides: Record<string, unknown> = {}, extra: Record<string, string> = {}) =>
  fakeZip({ [`${name}.dll`]: `${name} code`, [`${name}.json`]: JSON.stringify({ InternalName: name, Name: name, AssemblyVersion: version, DalamudApiLevel: 15, ...overrides }), ...extra })
const repoEntry = (name: string, version = '1.0.0.0', level = 15, link = `https://downloads.test/${name}.zip`) =>
  ({ InternalName: name, Name: name, AssemblyVersion: version, DalamudApiLevel: level, DownloadLinkInstall: link })

interface Options { installed?: string[]; repos?: { url: string; enabled?: boolean }[]; config?: string | null; level?: number | null; remote?: Record<string, string>; launcher?: string | null; machine?: Machine }

/** A machine with Dalamud in a given state and every starter plugin published. */
function setup(options: Options = {}) {
  const level = options.level === undefined ? 15 : options.level
  const files: Record<string, string> = {
    [`${XL}\\launcherConfigV3.json`]: options.launcher === undefined ? JSON.stringify({ GamePath: 'C:\\Games\\FFXIV', InGameAddonEnabled: 'true' }) : options.launcher ?? '',
  }
  if (options.launcher === null) delete files[`${XL}\\launcherConfigV3.json`]
  if (options.config !== null) files[CONFIG] = options.config ?? dalamudConfig(options.repos ?? [{ url: SEA }, { url: ATR }])
  for (const name of options.installed ?? []) files[`${PLUGINS}\\${name}\\1.0.0.0\\${name}.dll`] = 'dll'
  const remote: Record<string, string> = {
    [OFFICIAL_REPO_URL]: JSON.stringify(['Weatherman', 'AcrylicXIV', 'CharacterPanelRefined', 'MultiHit'].map((n) => repoEntry(n))),
    [SEA]: JSON.stringify([repoEntry('Penumbra'), repoEntry('Glamourer'), repoEntry('heliosphere-plugin', '4.10.7.0', 15, heliosphereZipUrl)]),
    [ATR]: JSON.stringify([repoEntry('ActionTimelineReplacement')]),
    ...Object.fromEntries(['Weatherman', 'AcrylicXIV', 'CharacterPanelRefined', 'MultiHit', 'Penumbra', 'Glamourer', 'ActionTimelineReplacement'].map((n) => [`https://downloads.test/${n}.zip`, pluginZip(n)])),
    [heliosphereZipUrl]: pluginZip('heliosphere-plugin', '4.10.7.0'),
    ...options.remote,
  }
  const directories = level === null ? [] : [`${XL}\\addon\\Hooks\\${level}.0.3.7`]
  const fake = createFakePlatform({ ...options.machine, files: { ...files, ...options.machine?.files }, directories: [...directories, ...(options.machine?.directories ?? [])], remoteText: remote })
  return { fake, files }
}

/** Calls the port records: what was fetched and downloaded. */
function spy(fake: FakePlatform) {
  const fetched: string[] = []
  const original = fake.fetchText.bind(fake)
  fake.fetchText = async (url) => { fetched.push(url); return original(url) }
  return { fetched, downloaded: fake.downloads }
}

const options = (platform: Platform, over: Partial<SeedOptions> = {}): SeedOptions => ({ stagingRoot: STAGING, guard: closedGuard(platform), ...over })
const leftovers = async (fake: FakePlatform) => (await fake.listFiles(STAGING).catch(() => [])).length

describe('scanStarterSet', () => {
  it('says there is no XIVLauncher when its settings are missing', async () => {
    const { fake } = setup({ launcher: null })
    const scan = await scanStarterSet(fake, SET)
    expect(scan.dalamud).toEqual({ status: 'no-xivlauncher' })
    expect(dalamudMessage(scan.dalamud)).toMatch(/XIVLauncher/)
  })

  it('says Dalamud is off when XIVLauncher has it switched off', async () => {
    const { fake } = setup({ launcher: JSON.stringify({ InGameAddonEnabled: 'false' }) })
    expect((await scanStarterSet(fake, SET)).dalamud).toEqual({ status: 'dalamud-off' })
  })

  it('reads a boolean switch as well as a string one', async () => {
    const { fake } = setup({ launcher: JSON.stringify({ InGameAddonEnabled: false }) })
    expect((await scanStarterSet(fake, SET)).dalamud.status).toBe('dalamud-off')
  })

  it('says Dalamud has not run when its config is missing', async () => {
    const { fake } = setup({ config: null })
    expect((await scanStarterSet(fake, SET)).dalamud).toEqual({ status: 'not-run' })
  })

  it('reports a config it cannot read instead of guessing', async () => {
    const { fake } = setup({ config: '{ broken' })
    const scan = await scanStarterSet(fake, SET)
    expect(scan.dalamud.status).toBe('unreadable')
    expect(dalamudMessage(scan.dalamud)).toMatch(/couldn’t read Dalamud/)
  })

  it('reads the repos, the installed plugins and the API level', async () => {
    const { fake } = setup({ installed: ['Penumbra', 'Weatherman'], repos: [{ url: SEA }, { url: ATR, enabled: false }] })
    const scan = await scanStarterSet(fake, SET)
    expect(scan.dalamud).toEqual({ status: 'ready' })
    expect(scan.thirdRepos).toEqual([{ url: SEA, enabled: true }, { url: ATR, enabled: false }])
    expect(scan.installedPlugins.sort()).toEqual(['Penumbra', 'Weatherman'])
    expect(scan.apiLevel).toBe(15)
  })

  it('takes the API level from the newest Dalamud build', async () => {
    const { fake } = setup({ level: 14, machine: { directories: [`${XL}\\addon\\Hooks\\15.1.0.0`, `${XL}\\addon\\Hooks\\dev`, `${XL}\\addon\\Hooks\\9.0.0.0`] } })
    expect((await scanStarterSet(fake, SET)).apiLevel).toBe(15)
  })

  it('has no API level when no build is found, and still scans', async () => {
    const { fake } = setup({ level: null })
    const scan = await scanStarterSet(fake, SET)
    expect(scan.apiLevel).toBeNull()
    expect(scan.dalamud.status).toBe('ready')
  })

  it('has no installed plugins when the folder does not exist yet', async () => {
    const { fake } = setup()
    expect((await scanStarterSet(fake, SET)).installedPlugins).toEqual([])
  })

  describe('mods', () => {
    const mods = 'C:\\FFXIV Mods'
    const penumbra = (dir: unknown) => ({ [`${XL}\\pluginConfigs\\Penumbra\\config\\penumbra.json`]: JSON.stringify({ Version: 100, ModDirectory: dir }) })
    const mod = (folder: string, website?: string) => ({ [`${mods}\\${folder}\\meta.json`]: JSON.stringify({ FileVersion: 4, Name: folder, ...(website ? { Website: website } : {}) }) })
    const hair = SET.mods.find((m) => m.name === 'Hair Defined 2')!
    const body = SET.mods.find((m) => m.name === 'The Body SE')!

    it('finds a mod by the Heliosphere ID in its meta.json, whatever the folder is called', async () => {
      const { fake } = setup({ machine: { files: { ...penumbra(mods), ...mod('my renamed hair', `https://heliosphere.app/mod/${hair.id}`), ...mod('Something else', 'https://example.com/') } } })
      const scan = await scanStarterSet(fake, SET)
      expect(scan.modDirectory).toBe(mods)
      expect(scan.installedMods).toEqual([hair.id])
      expect(modInstalled(scan, hair)).toBe(true)
      expect(modInstalled(scan, body)).toBe(false)
    })

    it('reads the ID whatever the case and trailing path of the address', async () => {
      const { fake } = setup({ machine: { files: { ...penumbra(mods), ...mod('hs-body', `HTTPS://Heliosphere.app/mod/${body.id.toUpperCase()}/versions`) } } })
      expect((await scanStarterSet(fake, SET)).installedMods).toEqual([body.id])
    })

    it('ignores folders without a readable meta.json and ones that name another mod', async () => {
      const { fake } = setup({ machine: { files: { ...penumbra(mods), [`${mods}\\broken\\meta.json`]: '{ nope', [`${mods}\\empty\\readme.txt`]: 'x', ...mod('other', 'https://heliosphere.app/mod/zzzzzzzzzzzzzzzzzzzzzzzzzz') } } })
      expect((await scanStarterSet(fake, SET)).installedMods).toEqual([])
    })

    it('has no mod directory when Penumbra has not set one', async () => {
      for (const dir of ['', '   ', null, 7]) {
        const { fake } = setup({ machine: { files: penumbra(dir) } })
        const scan = await scanStarterSet(fake, SET)
        expect(scan.modDirectory).toBeNull()
        expect(scan.installedMods).toEqual([])
      }
    })

    it('has no mod directory when Penumbra has no config yet', async () => {
      const { fake } = setup()
      expect((await scanStarterSet(fake, SET)).modDirectory).toBeNull()
    })

    it('keeps the directory but finds nothing when it is missing from the disk', async () => {
      const { fake } = setup({ machine: { files: penumbra('D:\\Gone') } })
      const scan = await scanStarterSet(fake, SET)
      expect(scan.modDirectory).toBe('D:\\Gone')
      expect(scan.installedMods).toEqual([])
    })
  })
})

describe('what each row can do', () => {
  const scanOf = (over: Partial<StarterSetScan> = {}): StarterSetScan => ({ dalamud: { status: 'ready' }, apiLevel: 15, thirdRepos: [], installedPlugins: [], modDirectory: null, installedMods: [], ...over })

  it('marks an installed plugin installed, whatever its case', () => {
    expect(pluginStatus(SET, scanOf({ installedPlugins: ['penumbra'] }), plugin('Penumbra'))).toBe('installed')
  })

  it('never offers the Heliosphere plugin to be fetched', () => {
    expect(pluginStatus(SET, scanOf(), plugin('heliosphere-plugin'))).toBe('manual')
    expect(pluginStatus(SET, scanOf({ installedPlugins: ['heliosphere-plugin'] }), plugin('heliosphere-plugin'))).toBe('installed')
  })

  it('marks a plugin whose repository is switched off', () => {
    expect(pluginStatus(SET, scanOf({ thirdRepos: [{ url: SEA, enabled: false }] }), plugin('Penumbra'))).toBe('repo-off')
    expect(pluginStatus(SET, scanOf({ thirdRepos: [{ url: SEA, enabled: true }] }), plugin('Penumbra'))).toBe('available')
    expect(pluginStatus(SET, scanOf(), plugin('Weatherman'))).toBe('available')
  })

  it('adds the core plugins with the switch on, plus the extras that were ticked', () => {
    const names = (plugins: StarterPlugin[]) => plugins.map((p) => p.internalName)
    expect(names(pluginsToAdd(SET, scanOf(), { core: true, extras: [] }))).toEqual(['Penumbra', 'Glamourer', 'Weatherman', 'AcrylicXIV', 'ActionTimelineReplacement'])
    expect(names(pluginsToAdd(SET, scanOf(), { core: false, extras: ['MultiHit'] }))).toEqual(['MultiHit'])
    expect(names(pluginsToAdd(SET, scanOf({ installedPlugins: ['Penumbra', 'MultiHit'] }), { core: true, extras: ['MultiHit', 'CharacterPanelRefined'] }))).toEqual(['Glamourer', 'Weatherman', 'AcrylicXIV', 'ActionTimelineReplacement', 'CharacterPanelRefined'])
    expect(names(pluginsToAdd(SET, scanOf(), { core: false, extras: [] }))).toEqual([])
  })

  it('needs a repo entry only for third-party repos the player lacks', () => {
    const all = pluginsToAdd(SET, scanOf(), { core: true, extras: [] })
    expect(reposToAdd(SET, scanOf(), all).map((r) => r.id)).toEqual(['seaofstars', 'action-timeline-replacement'])
    expect(reposToAdd(SET, scanOf({ thirdRepos: [{ url: SEA, enabled: true }] }), all).map((r) => r.id)).toEqual(['action-timeline-replacement'])
    expect(reposToAdd(SET, scanOf(), [plugin('Weatherman'), plugin('MultiHit')])).toEqual([])
  })
})

describe('seedPlugins', () => {
  const scanAndSeed = async (fake: FakePlatform, names: string[], over: Partial<SeedOptions> = {}, set = SET) => {
    const scan = await scanStarterSet(fake, set)
    return seedPlugins(fake, set, scan, names.map((name) => set.plugins.find((p) => p.internalName === name)!), options(fake, over))
  }

  it('places an official plugin where Dalamud finds it, marked OFFICIAL', async () => {
    const { fake } = setup()
    const outcome = await scanAndSeed(fake, ['Weatherman'])
    expect(outcome).toEqual({ placed: [{ name: 'Weatherman', version: '1.0.0.0' }], skipped: [], reposAdded: [] })
    expect(await fake.readText(`${PLUGINS}\\Weatherman\\1.0.0.0\\Weatherman.dll`)).toBe('Weatherman code')
    const manifestOnDisk = JSON.parse(await fake.readText(`${PLUGINS}\\Weatherman\\1.0.0.0\\Weatherman.json`))
    expect(manifestOnDisk).toMatchObject({ InternalName: 'Weatherman', AssemblyVersion: '1.0.0.0', DalamudApiLevel: 15, InstalledFromUrl: 'OFFICIAL' })
    // It adds nothing Dalamud writes itself.
    expect(manifestOnDisk).not.toHaveProperty('WorkingPluginId')
    expect(manifestOnDisk).not.toHaveProperty('IsThirdParty')
  })

  it('copies every file in the zip, folders included', async () => {
    const { fake } = setup({ remote: { 'https://downloads.test/Weatherman.zip': pluginZip('Weatherman', '2.5.0.6', {}, { 'Resources\\icon.png': 'icon', 'Weatherman.deps.json': '{}' }) } })
    await scanAndSeed(fake, ['Weatherman'])
    const placed = await fake.listFiles(`${PLUGINS}\\Weatherman\\2.5.0.6`)
    expect(placed.map((p) => p.toLowerCase()).sort()).toEqual(['resources\\icon.png', 'weatherman.deps.json', 'weatherman.dll', 'weatherman.json'])
  })

  it('names the version folder after the plugin’s own manifest', async () => {
    const { fake } = setup({ remote: { 'https://downloads.test/Weatherman.zip': pluginZip('Weatherman', '2.5.0.6'), [OFFICIAL_REPO_URL]: JSON.stringify([repoEntry('Weatherman', '9.9.9.9')]) } })
    expect((await scanAndSeed(fake, ['Weatherman'])).placed).toEqual([{ name: 'Weatherman', version: '2.5.0.6' }])
  })

  it('appends a third-party repo to Dalamud’s list and marks the plugin with its exact address', async () => {
    const { fake } = setup({ repos: [] })
    const outcome = await scanAndSeed(fake, ['Penumbra'])
    expect(outcome.reposAdded).toEqual([SEA])
    expect(readThirdRepos(await fake.readText(CONFIG)).map((r) => r.url)).toEqual([SEA])
    expect(JSON.parse(await fake.readText(`${PLUGINS}\\Penumbra\\1.0.0.0\\Penumbra.json`)).InstalledFromUrl).toBe(SEA)
  })

  it('leaves the list alone when its repos are already there', async () => {
    const { fake, files } = setup()
    const outcome = await scanAndSeed(fake, ['Penumbra', 'Glamourer', 'ActionTimelineReplacement'])
    expect(outcome.reposAdded).toEqual([])
    expect(outcome.placed.map((p) => p.name)).toEqual(['Penumbra', 'Glamourer', 'ActionTimelineReplacement'])
    expect(await fake.readText(CONFIG)).toBe(files[CONFIG])
  })

  it('reads each repo’s plugin list once', async () => {
    const { fake } = setup()
    const { fetched } = spy(fake)
    await scanAndSeed(fake, ['Penumbra', 'Glamourer', 'Weatherman', 'AcrylicXIV'])
    expect(fetched.filter((url) => url === SEA)).toHaveLength(1)
    expect(fetched.filter((url) => url === OFFICIAL_REPO_URL)).toHaveLength(1)
  })

  it('clears its staging folder', async () => {
    const { fake } = setup()
    await scanAndSeed(fake, ['Weatherman', 'Penumbra'])
    expect(await leftovers(fake)).toBe(0)
  })

  describe('Heliosphere', () => {
    it('is never fetched, even when it is asked for', async () => {
      const { fake } = setup()
      const { fetched, downloaded } = spy(fake)
      const outcome = await scanAndSeed(fake, ['Penumbra', 'heliosphere-plugin'])
      expect(outcome.placed.map((p) => p.name)).toEqual(['Penumbra'])
      expect(outcome.skipped).toEqual([{ name: 'Heliosphere', reason: expect.stringMatching(/plugin installer/) }])
      expect([...fetched, ...downloaded].filter((url) => /heliosphere/i.test(url))).toEqual([])
      await expect(fake.stat(`${PLUGINS}\\heliosphere-plugin`)).rejects.toMatchObject({ kind: 'not-found' })
    })

    it('is refused by address too, if a set ever marked it fetchable', async () => {
      const fetchable: StarterSet = { ...SET, plugins: SET.plugins.map((p) => p.internalName === 'heliosphere-plugin' ? { ...p, manual: undefined } : p) }
      const { fake } = setup()
      const { downloaded } = spy(fake)
      const outcome = await scanAndSeed(fake, ['heliosphere-plugin'], {}, fetchable)
      expect(outcome.placed).toEqual([])
      expect(outcome.skipped[0].reason).toMatch(/doesn’t allow other programs/)
      expect(downloaded).toEqual([])
    })

    it('is refused when a repo points any plugin at a Heliosphere address', async () => {
      const { fake } = setup({ remote: { [OFFICIAL_REPO_URL]: JSON.stringify([repoEntry('Weatherman', '1.0.0.0', 15, 'https://cdn.heliosphere.app/x.zip')]) } })
      const { downloaded } = spy(fake)
      const outcome = await scanAndSeed(fake, ['Weatherman'])
      expect(outcome.placed).toEqual([])
      expect(downloaded).toEqual([])
    })
  })

  describe('what it will not add', () => {
    it('skips a plugin that is already installed without downloading it', async () => {
      const { fake } = setup({ installed: ['Weatherman'] })
      const { downloaded } = spy(fake)
      const outcome = await scanAndSeed(fake, ['Weatherman', 'AcrylicXIV'])
      expect(outcome.placed.map((p) => p.name)).toEqual(['AcrylicXIV'])
      expect(downloaded).toEqual(['https://downloads.test/AcrylicXIV.zip'])
      expect(await fake.readText(`${PLUGINS}\\Weatherman\\1.0.0.0\\Weatherman.dll`)).toBe('dll')
    })

    it('skips a plugin whose repository is switched off, and does not turn it on', async () => {
      const { fake, files } = setup({ repos: [{ url: SEA, enabled: false }, { url: ATR }] })
      const { fetched } = spy(fake)
      const outcome = await scanAndSeed(fake, ['Penumbra', 'Weatherman'])
      expect(outcome.placed.map((p) => p.name)).toEqual(['Weatherman'])
      expect(outcome.skipped).toEqual([{ name: 'Penumbra', reason: expect.stringMatching(/turned off in Dalamud/) }])
      expect(fetched).not.toContain(SEA)
      expect(await fake.readText(CONFIG)).toBe(files[CONFIG])
    })

    it('skips a plugin built for another Dalamud API level', async () => {
      const { fake } = setup({ level: 14 })
      const outcome = await scanAndSeed(fake, ['Weatherman'])
      expect(outcome.placed).toEqual([])
      expect(outcome.skipped[0].reason).toMatch(/API 15.*API 14/)
      expect(await leftovers(fake)).toBe(0)
    })

    it('does not compare API levels when Dalamud’s level is unknown', async () => {
      const { fake } = setup({ level: null })
      expect((await scanAndSeed(fake, ['Weatherman'])).placed).toHaveLength(1)
    })

    it('skips a plugin its repository no longer lists', async () => {
      const { fake } = setup({ remote: { [OFFICIAL_REPO_URL]: JSON.stringify([repoEntry('AcrylicXIV')]) } })
      const outcome = await scanAndSeed(fake, ['Weatherman', 'AcrylicXIV'])
      expect(outcome.placed.map((p) => p.name)).toEqual(['AcrylicXIV'])
      expect(outcome.skipped).toEqual([{ name: 'Weatherman', reason: expect.stringMatching(/doesn’t list it/) }])
    })

    it('matches the repo entry by exact name', async () => {
      const { fake } = setup({ remote: { [OFFICIAL_REPO_URL]: JSON.stringify([repoEntry('weatherman')]) } })
      expect((await scanAndSeed(fake, ['Weatherman'])).skipped).toHaveLength(1)
    })

    it('skips every plugin of a repo whose list cannot be read, and carries on with the rest', async () => {
      const { fake } = setup({ remote: { [OFFICIAL_REPO_URL]: 'not json' } })
      const outcome = await scanAndSeed(fake, ['Weatherman', 'Penumbra'])
      expect(outcome.placed.map((p) => p.name)).toEqual(['Penumbra'])
      expect(outcome.skipped[0].reason).toMatch(/couldn’t read Dalamud’s plugin list/)
    })

    it('skips a repo that cannot be reached', async () => {
      const { fake } = setup()
      delete (fake as unknown as { remote?: unknown }).remote
      fake.fetchText = async (url) => { if (url === SEA) throw new PlatformError('network', 'offline'); return createFakePlatform({ remoteText: {} }).fetchText(url) }
      const outcome = await scanAndSeed(fake, ['Penumbra'])
      expect(outcome.placed).toEqual([])
      expect(outcome.skipped[0].reason).toMatch(/SeaOfStars plugin list/)
    })

    it('skips a download that is for a different plugin', async () => {
      const { fake } = setup({ remote: { 'https://downloads.test/Weatherman.zip': pluginZip('Glamourer') } })
      const outcome = await scanAndSeed(fake, ['Weatherman'])
      expect(outcome.skipped[0].reason).toMatch(/different plugin|not laid out/)
      await expect(fake.stat(`${PLUGINS}\\Weatherman`)).rejects.toMatchObject({ kind: 'not-found' })
    })

    it('skips a download whose manifest names another plugin than its files do', async () => {
      const { fake } = setup({ remote: { 'https://downloads.test/Weatherman.zip': pluginZip('Weatherman', '1.0.0.0', { InternalName: 'Other' }) } })
      expect((await scanAndSeed(fake, ['Weatherman'])).skipped[0].reason).toMatch(/different plugin/)
    })

    it('skips a download that is not laid out as a plugin', async () => {
      const { fake } = setup({ remote: { 'https://downloads.test/Weatherman.zip': fakeZip({ 'readme.txt': 'x' }) } })
      expect((await scanAndSeed(fake, ['Weatherman'])).skipped[0].reason).toMatch(/not laid out/)
    })

    it.each(['latest', '1', '1.2.3.4.5', '..\\..', '1.0.0.0\\x', ''])('skips a version that is not one Dalamud can read: %j', async (version) => {
      const { fake } = setup({ remote: { 'https://downloads.test/Weatherman.zip': pluginZip('Weatherman', version) } })
      const outcome = await scanAndSeed(fake, ['Weatherman'])
      expect(outcome.placed).toEqual([])
      expect(outcome.skipped[0].reason).toMatch(/usable version/)
      await expect(fake.stat(`${PLUGINS}\\Weatherman`)).rejects.toMatchObject({ kind: 'not-found' })
    })

    it.each(['..\\evil.dll', 'sub\\..\\..\\evil.dll', 'C:\\evil.dll', 'a:stream', 'CON.txt', 'trailing.'])('refuses a zip entry that could escape: %s', async (entry) => {
      const { fake } = setup({ remote: { 'https://downloads.test/Weatherman.zip': fakeZip({ 'Weatherman.dll': 'x', 'Weatherman.json': JSON.stringify({ InternalName: 'Weatherman', AssemblyVersion: '1.0.0.0' }), [entry]: 'evil' }) } })
      const outcome = await scanAndSeed(fake, ['Weatherman'])
      expect(outcome.placed).toEqual([])
      expect(outcome.skipped).toHaveLength(1)
      await expect(fake.stat(`${PLUGINS}\\Weatherman`)).rejects.toMatchObject({ kind: 'not-found' })
      await expect(fake.stat(`${XL}\\evil.dll`)).rejects.toMatchObject({ kind: 'not-found' })
      expect(await leftovers(fake)).toBe(0)
    })

    it('does not replace a folder that appeared while it worked', async () => {
      const { fake } = setup()
      let calls = 0
      const wrapped = { ...fake, async listFolders(root: string) {
        const names = await fake.listFolders(root).catch(() => [] as string[])
        return root === PLUGINS && ++calls > 0 ? [...names, 'Weatherman'] : names
      } } as FakePlatform
      const scan = await scanStarterSet(fake, SET)
      const outcome = await seedPlugins(wrapped, SET, scan, [plugin('Weatherman')], options(wrapped))
      expect(outcome.placed).toEqual([])
      expect(outcome.skipped[0].reason).toMatch(/installed while Lucent was working/)
    })
  })

  describe('while XIV or XIVLauncher run', () => {
    it('refuses before fetching anything when XIV is running', async () => {
      const { fake } = setup({ machine: { gameRunning: true } })
      const { fetched, downloaded } = spy(fake)
      await expect(scanAndSeed(fake, ['Weatherman'])).rejects.toThrow(/Close XIV/)
      expect([...fetched, ...downloaded]).toEqual([])
    })

    it('refuses when XIVLauncher is running', async () => {
      const { fake } = setup({ machine: { processes: ['XIVLauncher.exe'] } })
      await expect(scanAndSeed(fake, ['Weatherman'])).rejects.toThrow(/Close XIVLauncher/)
    })

    it('checks again after the downloads and writes nothing if XIV was started meanwhile', async () => {
      const { fake, files } = setup({ repos: [] })
      let asked = 0
      const outcome = scanAndSeed(fake, ['Penumbra', 'Weatherman'], { guard: async () => { if (++asked >= 2) throw new Error('Close XIV, then try again.') } })
      await expect(outcome).rejects.toThrow(/Close XIV/)
      expect(await fake.readText(CONFIG)).toBe(files[CONFIG])
      await expect(fake.stat(`${PLUGINS}\\Penumbra`)).rejects.toMatchObject({ kind: 'not-found' })
      await expect(fake.stat(`${PLUGINS}\\Weatherman`)).rejects.toMatchObject({ kind: 'not-found' })
      expect(await leftovers(fake)).toBe(0)
    })

    it('checks again before each plugin is copied in', async () => {
      const { fake } = setup()
      let asked = 0
      const outcome = scanAndSeed(fake, ['Weatherman', 'AcrylicXIV'], { guard: async () => { if (++asked >= 4) throw new Error('Close XIV, then try again.') } })
      await expect(outcome).rejects.toThrow(/Close XIV/)
      expect((await fake.listFolders(PLUGINS)).sort()).toEqual(['Weatherman'])
      expect(await leftovers(fake)).toBe(0)
    })
  })

  describe('when Dalamud’s config cannot be edited', () => {
    it('places nothing and says so', async () => {
      const { fake } = setup({ config: JSON.stringify({ DoPluginTest: false }) })
      await expect(scanAndSeed(fake, ['Penumbra', 'Weatherman'])).rejects.toThrow(/didn’t change Dalamud’s settings/)
      await expect(fake.stat(`${PLUGINS}\\Penumbra`)).rejects.toMatchObject({ kind: 'not-found' })
      await expect(fake.stat(`${PLUGINS}\\Weatherman`)).rejects.toMatchObject({ kind: 'not-found' })
      expect(await leftovers(fake)).toBe(0)
    })

    it('is not needed for official plugins alone', async () => {
      const { fake } = setup({ config: JSON.stringify({ DoPluginTest: false }) })
      expect((await scanAndSeed(fake, ['Weatherman'])).placed).toHaveLength(1)
    })

    it('refuses without Dalamud ready', async () => {
      const { fake } = setup({ config: null })
      await expect(scanAndSeed(fake, ['Weatherman'])).rejects.toThrow(/hasn’t run/)
    })
  })

  describe('when placing a plugin fails halfway', () => {
    it('removes what it placed and carries on with the others', async () => {
      const { fake } = setup({ remote: { 'https://downloads.test/Weatherman.zip': pluginZip('Weatherman', '1.0.0.0', {}, { 'Resources\\a.png': 'a', 'Resources\\b.png': 'b' }) } })
      const scan = await scanStarterSet(fake, SET)
      let copied = 0
      const wrapped = { ...fake, async copyMany(items: Parameters<Platform['copyMany']>[0]) {
        if (items.some((item) => /Weatherman/.test(item.to))) { await fake.copyFile(items[0].from, items[0].to, false); copied++; throw new PlatformError('disk-full', 'Disk full') }
        return fake.copyMany(items)
      } } as FakePlatform
      const outcome = await seedPlugins(wrapped, SET, scan, ['Weatherman', 'AcrylicXIV'].map(plugin), options(wrapped))
      expect(copied).toBe(1)
      expect(outcome.placed.map((p) => p.name)).toEqual(['AcrylicXIV'])
      expect(outcome.skipped).toEqual([{ name: 'Weatherman', reason: 'Disk full' }])
      expect(await fake.listFolders(PLUGINS)).toEqual(['AcrylicXIV'])
      expect(await leftovers(fake)).toBe(0)
    })
  })

  it('reports what it did through the log and progress callbacks', async () => {
    const { fake } = setup({ repos: [] })
    const lines: string[] = []
    const steps: string[] = []
    await scanAndSeed(fake, ['Penumbra', 'Weatherman'], { log: (_level, text) => lines.push(text), progress: (text) => steps.push(text) })
    expect(lines).toEqual([
      `Starter set: added ${SEA} to Dalamud’s custom repositories`,
      'Starter set: added Penumbra 1.0.0.0 from SeaOfStars',
      'Starter set: added Weatherman 1.0.0.0 from Dalamud’s repository',
    ])
    expect(steps[0]).toBe('Downloading Penumbra (1 of 2)…')
    expect(steps.at(-1)).toBe('Adding Weatherman (2 of 2)…')
  })
})
