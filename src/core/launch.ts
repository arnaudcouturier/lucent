// How the player starts XIV, so Lucent's Launch opens the same thing they would: XIVLauncher when it's set up for this
// game folder, Steam for a Steam copy, or the Square Enix launcher in the folder's `boot`.
import type { Platform } from './platform'
import { STEAM_APP_ID, type GameFolder } from './gameFolder'
import { maybeStat } from './deployment'
import { joinPath, normalizePath } from './paths'
import { xivLauncherGamePath } from './xivLauncher'

export type LaunchKind = 'xivlauncher' | 'steam' | 'official'

export interface LaunchOption {
  kind: LaunchKind
  /** The program to start; Steam is asked by app id instead. */
  path: string | null
}

export const LAUNCH_LABELS: Record<LaunchKind, string> = { xivlauncher: 'XIVLauncher', steam: 'Steam', official: 'Square Enix launcher' }

const isFile = async (platform: Platform, path: string) => (await maybeStat(platform, path).catch(() => null))?.kind === 'file'
const samePath = (a: string, b: string) => normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase()

/** A Steam copy sits in a Steam library's `steamapps\common`, beside Steam's manifest for XIV. */
async function isSteamCopy(platform: Platform, folder: GameFolder): Promise<boolean> {
  if (folder.source === 'steam') return true
  const library = /^(.*)\\steamapps\\common\\[^\\]+$/i.exec(normalizePath(folder.path))?.[1]
  return !!library && isFile(platform, joinPath(library, 'steamapps', `appmanifest_${STEAM_APP_ID}.acf`))
}

/** The ways this game folder can be started, the usual one first. */
export async function launchOptions(platform: Platform, folder: GameFolder): Promise<LaunchOption[]> {
  const options: LaunchOption[] = []
  const local = await platform.envFolder('LocalAppData')
  // Velopack installs XIVLauncher in `current`; older Squirrel installs keep a stub beside the versions.
  for (const exe of [joinPath(local, 'XIVLauncher', 'current', 'XIVLauncher.exe'), joinPath(local, 'XIVLauncher', 'XIVLauncher.exe')]) {
    if (!await isFile(platform, exe)) continue
    // XIVLauncher starts the folder its settings name; for another folder it would start a different install.
    const configured = await xivLauncherGamePath(platform).catch(() => null)
    if (configured && samePath(configured, folder.path)) options.push({ kind: 'xivlauncher', path: exe })
    break
  }
  // A Steam copy only starts through Steam (or XIVLauncher); its own boot launcher hands back to Steam anyway.
  if (await isSteamCopy(platform, folder)) options.push({ kind: 'steam', path: null })
  else {
    const boot = joinPath(folder.path, 'boot', 'ffxivboot.exe')
    if (await isFile(platform, boot)) options.push({ kind: 'official', path: boot })
  }
  return options
}

/** The player's choice while it's still possible here, else the usual way. */
export function chosenLauncher(options: LaunchOption[], preferred: LaunchKind | null): LaunchKind | null {
  return options.find((o) => o.kind === preferred)?.kind ?? options[0]?.kind ?? null
}

export const STEAM_GAME_ID = Number(STEAM_APP_ID)
