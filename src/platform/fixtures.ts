// Machine layouts for the fake Platform: game folders and the launchers that point at them.
// Shared by the core's tests, the state gallery and the app running in a browser.
import { DEFAULT_ENV, FAKE_EXE_PATH, type Machine } from './fake'
import manifest from '../../manifest.json'
import { MANIFEST_URL } from '../core/manifest'
import { NEXT_MANIFEST, OPTISCALER_NEXT_HASH, PROFILE_ASSETS, PROFILE_MANIFEST, fixtureUrl, nextFixtureUrl } from './contentFixture'

export const STEAM_DEFAULT = 'C:\\Program Files (x86)\\Steam'
export const SQUARE_ENIX_DEFAULT = 'C:\\Program Files (x86)\\SquareEnix\\FINAL FANTASY XIV - A Realm Reborn'
export const SQUARE_ENIX_UNINSTALL_KEY =
  'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{2B41E132-07DF-4925-A3D3-F2D1765CCDFE}'

/** Merges machine parts; later parts win on conflicts. */
export function machine(...parts: Machine[]): Machine {
  const out: Required<Machine> = { files: {}, directories: [], registry: {}, env: {}, gpus: [], remoteText: {}, devContent: null, gameRunning: false, exePath: FAKE_EXE_PATH }
  for (const p of parts) {
    Object.assign(out.files, p.files)
    out.directories.push(...(p.directories ?? []))
    for (const [key, values] of Object.entries(p.registry ?? {})) out.registry[key] = { ...out.registry[key], ...values }
    Object.assign(out.env, p.env)
    if (p.gpus) out.gpus = p.gpus
    Object.assign(out.remoteText, p.remoteText)
    if (p.devContent !== undefined) out.devContent = p.devContent
    if (p.gameRunning !== undefined) out.gameRunning = p.gameRunning
    if (p.exePath !== undefined) out.exePath = p.exePath
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

/** The release host after the next content version is published: its manifest and its one new asset. */
export function nextContentHost(): Machine {
  return { remoteText: { ...fixtureContentHost().remoteText, [MANIFEST_URL]: JSON.stringify(NEXT_MANIFEST), [nextFixtureUrl(OPTISCALER_NEXT_HASH)]: 'OptiScaler 2' } }
}

export function graphicsCard(name = 'NVIDIA GeForce RTX 4090', vendorId = 0x10de): Machine {
  return { gpus: [{ name, vendorId, dedicatedMemory: 24 * 1024 ** 3, software: false }] }
}

/** The Square Enix launcher's uninstall entry, pointing at `installLocation`. */
export function squareEnixLauncher(installLocation: string): Machine {
  return { registry: { [`HKLM\\${SQUARE_ENIX_UNINSTALL_KEY}`]: { InstallLocation: installLocation, DisplayName: 'FINAL FANTASY XIV ONLINE' } } }
}

/** Named machines for the browser and the state gallery. */
export const MACHINES = {
  steam: machine(fixtureContentHost(), graphicsCard(), steam({ libraries: ['D:\\SteamLibrary'], game: 'D:\\SteamLibrary' }), vanillaGame(steamGameFolder('D:\\SteamLibrary'))),
  xivlauncher: machine(fixtureContentHost(), graphicsCard(), xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV')),
  squareenix: machine(fixtureContentHost(), graphicsCard(), squareEnixLauncher(SQUARE_ENIX_DEFAULT), vanillaGame(SQUARE_ENIX_DEFAULT)),
  existing: machine(fixtureContentHost(), graphicsCard(), xivLauncher('C:\\Games\\FFXIV'), vanillaGame('C:\\Games\\FFXIV'), existingSetup('C:\\Games\\FFXIV', 'reshade'), existingSetup('C:\\Games\\FFXIV', 'dlss-swap')),
  none: machine(manifestHost(), graphicsCard()),
} satisfies Record<string, Machine>

export type MachineName = keyof typeof MACHINES
