// Finding and validating the game folder: the FFXIV directory whose `game\` holds the DX11 executable.
import type { Platform } from './platform'
import { joinPath, normalizePath } from './paths'
import { parseVdf, type Vdf } from './vdf'
import { xivLauncherGamePath } from './xivLauncher'

export type GameFolderSource = 'xivlauncher' | 'steam' | 'square-enix' | 'default' | 'picked'

export interface GameFolder {
  path: string
  source: GameFolderSource
  version: string | null
}

export const STEAM_APP_ID = '39210'

/** The DX11 game executable, relative to the game folder. Its presence is what makes a folder the game folder. */
export const GAME_EXECUTABLE = 'game\\ffxiv_dx11.exe'

/** Runs `f`, turning any failure into null: a source that can't be read simply has nothing to offer. */
const attempt = async <T>(f: () => Promise<T>): Promise<T | null> => {
  try {
    return await f()
  } catch {
    return null
  }
}

async function xivLauncherPaths(platform: Platform): Promise<string[]> {
  const path = await xivLauncherGamePath(platform)
  return path ? [path] : []
}

/** The libraries in Steam's library list. Each is a block with a "path", or a bare path in the older format. */
async function steamLibraries(platform: Platform, steamPath: string): Promise<string[]> {
  const folders = parseVdf(await platform.readText(joinPath(steamPath, 'steamapps', 'libraryfolders.vdf'))).libraryfolders
  if (typeof folders !== 'object') return []
  return Object.entries(folders).flatMap(([key, folder]) => {
    if (typeof folder === 'object') return typeof folder.path === 'string' ? [normalizePath(folder.path)] : []
    return /^\d+$/.test(key) ? [normalizePath(folder)] : []
  })
}

async function steamPaths(platform: Platform): Promise<string[]> {
  const steamPath = normalizePath(await platform.readRegistry('HKCU', 'Software\\Valve\\Steam', 'SteamPath'))
  // Steam's own folder is always a library, even when the list can't be read.
  const libraries = (await attempt(() => steamLibraries(platform, steamPath))) ?? []
  if (!libraries.some((l) => l.toLowerCase() === steamPath.toLowerCase())) libraries.unshift(steamPath)

  const paths: string[] = []
  for (const library of libraries) {
    const manifest = await attempt(() => platform.readText(joinPath(library, 'steamapps', `appmanifest_${STEAM_APP_ID}.acf`)))
    if (manifest === null) continue
    const app = parseVdf(manifest).appstate as Vdf | undefined
    const installDir = typeof app?.installdir === 'string' ? app.installdir : 'FINAL FANTASY XIV Online'
    paths.push(joinPath(library, 'steamapps', 'common', installDir))
  }
  return paths
}

const SQUARE_ENIX_UNINSTALL_KEY =
  'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{2B41E132-07DF-4925-A3D3-F2D1765CCDFE}'

/** The entry's install location, then the folder of its icon (`"…\boot\ffxivboot.exe",0`). */
async function squareEnixPaths(platform: Platform): Promise<string[]> {
  const read = (value: string) => attempt(() => platform.readRegistry('HKLM', SQUARE_ENIX_UNINSTALL_KEY, value))
  const location = await read('InstallLocation')
  const icon = (await read('DisplayIcon'))?.replace(/,\s*-?\d+$/, '').replace(/"/g, '')
  return [location, icon?.replace(/\\boot\\[^\\]+$/i, '')].filter((p): p is string => !!p)
}

async function defaultPaths(platform: Platform): Promise<string[]> {
  const roots = [await platform.envFolder('ProgramFilesX86'), await platform.envFolder('ProgramFiles')]
  return roots.flatMap((root) => [
    joinPath(root, 'SquareEnix', 'FINAL FANTASY XIV - A Realm Reborn'),
    joinPath(root, 'Steam', 'steamapps', 'common', 'FINAL FANTASY XIV Online'),
  ])
}

/** Where Scan looks for the game folder, in order. */
const SOURCES: [GameFolderSource, (platform: Platform) => Promise<string[]>][] = [
  ['xivlauncher', xivLauncherPaths],
  ['steam', steamPaths],
  ['square-enix', squareEnixPaths],
  ['default', defaultPaths],
]

/** A folder is a game folder only if it holds the DX11 game executable. */
export async function isGameFolder(platform: Platform, folder: string): Promise<boolean> {
  return (await attempt(() => platform.stat(joinPath(folder, GAME_EXECUTABLE))))?.kind === 'file'
}

async function readVersion(platform: Platform, folder: string): Promise<string | null> {
  return (await attempt(() => platform.readText(joinPath(folder, 'game', 'ffxivgame.ver'))))?.trim() || null
}

/** Checks a folder the player picked. Picking the `game` subfolder itself means the folder above it. */
export async function checkPickedFolder(platform: Platform, picked: string): Promise<GameFolder | null> {
  const path = normalizePath(picked)
  const parent = path.replace(/\\game$/i, '')
  for (const candidate of parent === path ? [path] : [path, parent]) {
    if (await isGameFolder(platform, candidate)) return { path: candidate, source: 'picked', version: await readVersion(platform, candidate) }
  }
  return null
}

export async function findGameFolder(platform: Platform): Promise<GameFolder | null> {
  for (const [source, candidates] of SOURCES) {
    for (const candidate of (await attempt(() => candidates(platform))) ?? []) {
      const path = normalizePath(candidate)
      if (await isGameFolder(platform, path)) return { path, source, version: await readVersion(platform, path) }
    }
  }
  return null
}
