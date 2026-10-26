// Machine layouts for the fake Platform: game folders and the launchers that point at them.
// Shared by the core's tests, the state gallery and the app running in a browser.
import { DEFAULT_ENV, FAKE_EXE_PATH, fakeZip, type Machine } from './fake'
import type { MonitorInfo } from '../core/platform'
import manifest from '../../manifest.json'
import { MANIFEST_URL } from '../core/manifest'
import { appBetaReleaseHost } from './appUpdateFixture'
import { BETA_MANIFEST, FRAME_GENERATION_MANIFEST, HDR_FRAME_GENERATION_MANIFEST, NEURAL_RENDERING_MANIFEST, NEXT_MANIFEST, OPTISCALER_NEXT_HASH, PROFILE_ASSETS, PROFILE_MANIFEST, PASS_HINT_MANIFEST, SETTING_CHOICE_MANIFEST, betaFixtureUrl, fixtureUrl, nextFixtureUrl } from './contentFixture'

export const STEAM_DEFAULT = 'C:\\Program Files (x86)\\Steam'
export const SQUARE_ENIX_DEFAULT = 'C:\\Program Files (x86)\\SquareEnix\\FINAL FANTASY XIV - A Realm Reborn'
export const SQUARE_ENIX_UNINSTALL_KEY =
  'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{2B41E132-07DF-4925-A3D3-F2D1765CCDFE}'

/** Merges machine parts; later parts win on conflicts. */
export function machine(...parts: Machine[]): Machine {
  const out: Required<Machine> = { files: {}, directories: [], registry: {}, env: {}, gpus: [], monitors: [], remoteText: {}, devContent: null, gameRunning: false, exePath: FAKE_EXE_PATH, windowsVersion: 'Windows 11 24H2 (build 26100.2033)', readOnlyDirectories: [], readOnlyFiles: [], elevated: false, elevationCancelled: false, elevationResumePath: null, userSid: 'S-1-5-21-100-200-300-1001', processes: [], headlessMode: null, operationLocks: new Set<string>(), freeSpace: {} }
  for (const p of parts) {
    Object.assign(out.files, p.files)
    out.directories.push(...(p.directories ?? []))
    for (const [key, values] of Object.entries(p.registry ?? {})) out.registry[key] = { ...out.registry[key], ...values }
    Object.assign(out.env, p.env)
    if (p.gpus) out.gpus = p.gpus
    if (p.monitors) out.monitors = p.monitors
    Object.assign(out.remoteText, p.remoteText)
    if (p.devContent !== undefined) out.devContent = p.devContent
    if (p.gameRunning !== undefined) out.gameRunning = p.gameRunning
    if (p.exePath !== undefined) out.exePath = p.exePath
    if (p.windowsVersion !== undefined) out.windowsVersion = p.windowsVersion
    if (p.readOnlyDirectories) out.readOnlyDirectories = p.readOnlyDirectories
    if (p.readOnlyFiles) out.readOnlyFiles = p.readOnlyFiles
    if (p.elevated !== undefined) out.elevated = p.elevated
    if (p.elevationCancelled !== undefined) out.elevationCancelled = p.elevationCancelled
    if (p.elevationResumePath !== undefined) out.elevationResumePath = p.elevationResumePath
    if (p.userSid !== undefined) out.userSid = p.userSid
    if (p.processes) out.processes = p.processes
    if (p.headlessMode !== undefined) out.headlessMode = p.headlessMode
    if (p.operationLocks !== undefined) out.operationLocks = p.operationLocks
    Object.assign(out.freeSpace, p.freeSpace)
  }
  return out
}

/** An untouched game folder: the DX11 executable and its version file under `game\`. */
export function vanillaGame(root: string, version = '2026.09.30.0000.0000'): Machine {
  return {
    files: {
      [`${root}\\boot\\ffxivboot.exe`]: 'MZ',
      [`${root}\\game\\ffxiv_dx11.exe`]: 'MZ',
      [`${root}\\game\\ffxivgame.ver`]: version,
    },
  }
}

/** Mod files another tool left in `game\`, one layout per kind of existing setup. Some collide with the test content's paths. */
export const EXISTING_SETUPS = {
  gshade: {
    'GShade.ini': '[GENERAL]\nPresetPath=.\\gshade-presets\\Custom\\Sunset.ini\n',
    'dxgi.dll': 'GShade',
    'gshade-presets\\Custom\\Sunset.ini': '[Sunset]\nBloom=1\n',
    'gshade-presets\\Example.ini': '[Their example]\n',
    'gshade-shaders\\Shaders\\Bloom.fx': 'GShade bloom',
  },
  reshade: {
    'ReShade.ini': '[GENERAL]\nPresetPath=.\\reshade-presets\\Mine.ini\n',
    'dxgi.dll': 'ReShade 6.3',
    'ReShadePreset.ini': '[Root preset]\n',
    'reshade-presets\\Mine.ini': '[Mine]\n',
    'reshade-presets\\Example.ini': '[My example edits]\n',
    'reshade-shaders\\Shaders\\Example.fx': 'Their example shader',
    'reshade-shaders\\Shaders\\Other.fx': 'Other shader',
  },
  gposingway: {
    'reshade-presets\\GPosingway\\Portrait.ini': '[Portrait]\n',
    'reshade-shaders\\Shaders\\GPosingway.fx': 'GPosingway shader',
  },
  optiscaler: {
    'OptiScaler.ini': '[Upscalers]\nDx11Upscaler=fsr22\n',
    'OptiScaler.log': 'old log',
    'winmm.dll': 'Older OptiScaler',
    'nvngx.dll': 'Spoofer',
  },
  'dlss-swap': {
    'nvngx_dlss.dll': 'DLSS 310.4',
    'nvngx_dlss.dll.dlsss': 'DLSS 3.7',
  },
} satisfies Record<string, Record<string, string>>
export type ExistingSetupFixture = keyof typeof EXISTING_SETUPS

export function existingSetup(root: string, kind: ExistingSetupFixture): Machine {
  return { files: Object.fromEntries(Object.entries(EXISTING_SETUPS[kind]).map(([path, text]) => [`${root}\\game\\${path}`, text])) }
}

/** XIVLauncher's config, pointing at `gamePath`. */
export function xivLauncher(gamePath: string, env = DEFAULT_ENV): Machine {
  return {
    files: {
      [`${env.AppData}\\XIVLauncher\\launcherConfigV3.json`]: JSON.stringify({ GamePath: gamePath, AddonList: '[]' }, null, 2),
    },
  }
}

/**
 * XIVLauncher with Dalamud run once, some starter plugins already in, and Penumbra pointing at a mod folder holding some of the
 * starter mods. The repos publish every starter plugin, so Add works on the fake machine too.
 */
export function dalamudSetup(options: { plugins?: string[]; mods?: Record<string, string>; modDirectory?: string | null } = {}, env = DEFAULT_ENV): Machine {
  const root = `${env.AppData}\\XIVLauncher`
  const modDirectory = options.modDirectory === undefined ? 'D:\\FFXIV Mods' : options.modDirectory
  const publish = (name: string) => ({ InternalName: name, Name: name, AssemblyVersion: '1.0.0.0', DalamudApiLevel: 15, DownloadLinkInstall: `https://downloads.fixture/${name}.zip` })
  const names = manifest.starterSet.plugins.map((plugin) => plugin.internalName)
  const files: Record<string, string> = {
    [`${root}\\launcherConfigV3.json`]: JSON.stringify({ GamePath: 'C:\\Games\\FFXIV', InGameAddonEnabled: 'true', AddonList: '[]' }, null, 2),
    [`${root}\\dalamudConfig.json`]: JSON.stringify({ ThirdRepoList: { $type: 'System.Collections.Generic.List`1[[Dalamud.Configuration.ThirdPartyRepoSettings, Dalamud]], System.Private.CoreLib', $values: [] } }, null, 2),
    ...Object.fromEntries((options.plugins ?? []).map((name) => [`${root}\\installedPlugins\\${name}\\1.0.0.0\\${name}.dll`, 'dll'])),
    ...(modDirectory === null ? {} : { [`${root}\\pluginConfigs\\Penumbra\\config\\penumbra.json`]: JSON.stringify({ Version: 100, ModDirectory: modDirectory }) }),
    ...Object.fromEntries(Object.entries(options.mods ?? {}).map(([folder, website]) => [`${modDirectory}\\${folder}\\meta.json`, JSON.stringify({ FileVersion: 4, Name: folder, Website: website })])),
  }
  const repoUrl = (id: string) => manifest.starterSet.repos.find((repo) => repo.id === id)!.url
  const listed = (repo: string) => JSON.stringify(manifest.starterSet.plugins.filter((plugin) => plugin.repo === repo).map((plugin) => publish(plugin.internalName)))
  return {
    files, directories: [`${root}\\addon\\Hooks\\15.0.3.7`],
    remoteText: {
      'https://kamori.goats.dev/Plugin/PluginMaster': listed('official'), [repoUrl('seaofstars')]: listed('seaofstars'), [repoUrl('action-timeline-replacement')]: listed('action-timeline-replacement'), [repoUrl('iinact')]: listed('iinact'),
      ...Object.fromEntries(names.map((name) => [`https://downloads.fixture/${name}.zip`, fakeZip({ [`${name}.dll`]: 'dll', [`${name}.json`]: JSON.stringify({ InternalName: name, AssemblyVersion: '1.0.0.0' }) })])),
    },
  }
}

const vdfPath = (p: string) => p.replace(/\\/g, '\\\\')

/**
 * Steam installed at `steamPath` with the given libraries. `game` is the library that holds XIV (app 39210),
 * installed under `installDir`. Steam's own folder is always library 0, as Steam writes it.
 */
export function steam(opts: { steamPath?: string; libraries?: string[]; game?: string; installDir?: string } = {}): Machine {
  const steamPath = opts.steamPath ?? STEAM_DEFAULT
  const libraries = [steamPath, ...(opts.libraries ?? []).filter((l) => l !== steamPath)]
  const blocks = libraries
    .map((lib, i) => `\t"${i}"\n\t{\n\t\t"path"\t\t"${vdfPath(lib)}"\n\t\t"label"\t\t""\n\t\t"apps"\n\t\t{\n\t\t}\n\t}`)
    .join('\n')
  const files: Record<string, string> = {
    [`${steamPath}\\steam.exe`]: 'MZ',
    [`${steamPath}\\steamapps\\libraryfolders.vdf`]: `"libraryfolders"\n{\n${blocks}\n}\n`,
  }
  if (opts.game) {
    const dir = opts.installDir ?? 'FINAL FANTASY XIV Online'
    files[`${opts.game}\\steamapps\\appmanifest_39210.acf`] =
      `"AppState"\n{\n\t"appid"\t\t"39210"\n\t"name"\t\t"FINAL FANTASY XIV Online"\n\t"installdir"\t\t"${dir}"\n}\n`
  }
  // Steam writes its path lower-cased with forward slashes.
  return { files, registry: { 'HKCU\\Software\\Valve\\Steam': { SteamPath: steamPath.replace(/\\/g, '/').toLowerCase() } } }
}

export const steamGameFolder = (library: string, installDir = 'FINAL FANTASY XIV Online') =>
  `${library}\\steamapps\\common\\${installDir}`

/** The fake release host serves the same tier definitions as the publisher. */
export function manifestHost(value: unknown = manifest): Machine {
  return { remoteText: { [MANIFEST_URL]: JSON.stringify(value) } }
}

/** The browser and gallery can complete the flow using inert fixture assets. */
export function fixtureContentHost(): Machine {
  return { remoteText: { [MANIFEST_URL]: JSON.stringify(PROFILE_MANIFEST), ...Object.fromEntries(Object.entries(PROFILE_ASSETS).map(([hash, text]) => [fixtureUrl(hash), text])) } }
}

/** Gallery-only frame-generation choices backed by inert settings. */
export function frameGenerationContentHost(): Machine {
  return { remoteText: { [MANIFEST_URL]: JSON.stringify(FRAME_GENERATION_MANIFEST), ...Object.fromEntries(Object.entries(PROFILE_ASSETS).map(([hash, text]) => [fixtureUrl(hash), text])) } }
}

/** Gallery-only first-install choices: four profiles, frame generation and HDR, backed by inert settings. */
export function firstInstallContentHost(): Machine {
  return { remoteText: { [MANIFEST_URL]: JSON.stringify(HDR_FRAME_GENERATION_MANIFEST), ...Object.fromEntries(Object.entries(PROFILE_ASSETS).map(([hash, text]) => [fixtureUrl(hash), text])) } }
}

/** First-install choices with Neural Rendering controls in place of profiles, frame generation, HDR and the multi-frame unlock. */
export function neuralRenderingContentHost(): Machine {
  return { remoteText: { [MANIFEST_URL]: JSON.stringify(NEURAL_RENDERING_MANIFEST), ...Object.fromEntries(Object.entries(PROFILE_ASSETS).map(([hash, text]) => [fixtureUrl(hash), text])) } }
}

/** Neural Rendering controls, frame generation, HDR and the UI mode and DLSS-G preset choices on the NVIDIA tiers. */
export function settingChoiceContentHost(): Machine {
  return { remoteText: { [MANIFEST_URL]: JSON.stringify(SETTING_CHOICE_MANIFEST), ...Object.fromEntries(Object.entries(PROFILE_ASSETS).map(([hash, text]) => [fixtureUrl(hash), text])) } }
}

/** The same with the Neural Rendering model's per-pass preset hints, placed inside the Neural Rendering card. */
export function passHintContentHost(): Machine {
  return { remoteText: { [MANIFEST_URL]: JSON.stringify(PASS_HINT_MANIFEST), ...Object.fromEntries(Object.entries(PROFILE_ASSETS).map(([hash, text]) => [fixtureUrl(hash), text])) } }
}

/** The release host after the next content version is published: its manifest and its one new asset. */
export function nextContentHost(): Machine {
  return { remoteText: { ...fixtureContentHost().remoteText, [MANIFEST_URL]: JSON.stringify(NEXT_MANIFEST), [nextFixtureUrl(OPTISCALER_NEXT_HASH)]: 'OptiScaler 2' } }
}

/** The release host with a Beta content version published beside the first Stable one: its manifest and its one new asset. */
export function betaContentHost(): Machine {
  return { remoteText: { ...fixtureContentHost().remoteText, [MANIFEST_URL]: JSON.stringify(BETA_MANIFEST), [betaFixtureUrl(OPTISCALER_NEXT_HASH)]: 'OptiScaler 2' } }
}

export function graphicsCard(name = 'NVIDIA GeForce RTX 4090', vendorId = 0x10de): Machine {
  return { gpus: [{ name, vendorId, dedicatedMemory: 24 * 1024 ** 3, software: false }] }
}

/** The Square Enix launcher's uninstall entry, pointing at `installLocation`. */
export function squareEnixLauncher(installLocation: string): Machine {
  return { registry: { [`HKLM\\${SQUARE_ENIX_UNINSTALL_KEY}`]: { InstallLocation: installLocation, DisplayName: 'FINAL FANTASY XIV ONLINE' } } }
}

function screenGallery(refreshHz: number, hdrOn: boolean, dual = false, content: Machine = fixtureContentHost()): Machine {
  const primaryWidth = dual ? 1920 : refreshHz === 60 ? 1920 : refreshHz === 144 ? 2560 : 3840
  const primaryHeight = dual ? 1080 : refreshHz === 60 ? 1080 : refreshHz === 144 ? 1440 : 2160
  const first: MonitorInfo = {
    deviceName: '\\\\.\\DISPLAY1', bounds: { left: 0, top: 0, right: primaryWidth, bottom: primaryHeight },
    primary: true, refreshHz: dual ? 60 : refreshHz, width: primaryWidth, height: primaryHeight,
    hdrSupported: !dual && hdrOn, hdrOn: !dual && hdrOn, peakNits: !dual && hdrOn ? 1000 : null,
  }
  const second: MonitorInfo = {
    deviceName: '\\\\.\\DISPLAY2', bounds: { left: 1920, top: 0, right: 5760, bottom: 2160 },
    primary: false, refreshHz, width: 3840, height: 2160, hdrSupported: true, hdrOn, peakNits: 1000,
  }
  const selected = dual ? second : first
  const displayConfig = [
    '<Display Settings>', `MainAdapter ${dual ? 'NVIDIA GeForce RTX 4090 (\\\\.\\DISPLAY2)' : ''}`,
    `ScreenLeft ${dual ? 100 : 20}`, 'ScreenTop 20', 'ScreenMode 1', `FullScreenWidth ${selected.width}`,
    `FullScreenHeight ${selected.height}`, `Refreshrate ${refreshHz}`,
  ].join('\r\n')
  const root = steamGameFolder('D:\\SteamLibrary')
  return machine(content, graphicsCard(), steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary' }), vanillaGame(root), {
    monitors: dual ? [first, second] : [first],
    files: { [`${DEFAULT_ENV.Documents}\\My Games\\FINAL FANTASY XIV - A Realm Reborn\\FFXIV.cfg`]: displayConfig },
  })
}

/** Named machines for the browser and the state gallery. */
export const MACHINES = {
  steam: machine(fixtureContentHost(), graphicsCard(), steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary' }), vanillaGame(steamGameFolder('D:\\SteamLibrary'))),
  xivlauncher: machine(fixtureContentHost(), graphicsCard(), xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV')),
  squareenix: machine(fixtureContentHost(), graphicsCard(), squareEnixLauncher(SQUARE_ENIX_DEFAULT), vanillaGame(SQUARE_ENIX_DEFAULT)),
  existing: machine(fixtureContentHost(), graphicsCard(), xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV'), existingSetup('C:\\Games\\FFXIV', 'reshade'), existingSetup('C:\\Games\\FFXIV', 'dlss-swap')),
  none: machine(manifestHost(), graphicsCard()),
  /** The Mods section: Dalamud set up with two starter plugins and one starter mod in, and a mod folder for Penumbra. */
  mods: machine(fixtureContentHost(), graphicsCard(), steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary' }), vanillaGame(steamGameFolder('D:\\SteamLibrary')),
    dalamudSetup({ plugins: ['Penumbra', 'Weatherman'], mods: { 'hs-Hair Defined 2-7.5.5-LkG': 'https://heliosphere.app/mod/am6y77mg6h1cn8agg7kqna6emc' } })),
  /** The Mods section before Penumbra has a mod folder, with the plugins not yet added. */
  modsFresh: machine(fixtureContentHost(), graphicsCard(), steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary' }), vanillaGame(steamGameFolder('D:\\SteamLibrary')), dalamudSetup({ modDirectory: null })),
  /** Browser gallery: representative 60/144/240 Hz panels, SDR/HDR, and a two-display layout. */
  screen60Sdr: screenGallery(60, false),
  screen144Hdr: screenGallery(144, true),
  screen240Dual: screenGallery(240, true, true),
  /** First-install choices on a 240 Hz HDR panel (RTX 40) and a 60 Hz SDR one (RTX 30), with frame generation, HDR and four profiles. */
  choices240Hdr: machine(screenGallery(240, true, false, firstInstallContentHost()), graphicsCard()),
  choices60Sdr: machine(screenGallery(60, false, false, firstInstallContentHost()), graphicsCard('NVIDIA GeForce RTX 3080')),
  nr240Hdr: machine(screenGallery(240, true, false, neuralRenderingContentHost()), graphicsCard()),
  nr60Sdr: machine(screenGallery(60, false, false, neuralRenderingContentHost()), graphicsCard('NVIDIA GeForce RTX 3080')),
  /** The same panels with the UI mode and DLSS-G preset choices: an RTX 40 on a 240 Hz HDR panel, and an RTX 30 on a 60 Hz SDR one. */
  settings240Hdr: machine(screenGallery(240, true, false, settingChoiceContentHost()), graphicsCard()),
  settings60Sdr: machine(screenGallery(60, false, false, settingChoiceContentHost()), graphicsCard('NVIDIA GeForce RTX 3080')),
  hints240Hdr: machine(screenGallery(240, true, false, passHintContentHost()), graphicsCard()),
  hints60Sdr: machine(screenGallery(60, false, false, passHintContentHost()), graphicsCard('NVIDIA GeForce RTX 3080')),
  /** Beta content and an app pre-release are published; turn on Beta channel in Settings to be offered them. */
  beta: machine(betaContentHost(), graphicsCard(), steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary' }), vanillaGame(steamGameFolder('D:\\SteamLibrary')), appBetaReleaseHost()),
} satisfies Record<string, Machine>

export type MachineName = keyof typeof MACHINES
