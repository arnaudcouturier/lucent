// The player's settings, in Lucent's data folder. They belong to the player, not to one game folder.
import type { Platform } from './platform'
import { joinPath } from './paths'
import { maybeStat } from './deployment'
import type { Channel } from './updates'
import type { LaunchKind } from './launch'

export interface Settings {
  /** Content versions the player skipped; they are no longer announced. */
  skippedContent: string[]
  /** App versions the player skipped; they are no longer announced. */
  skippedApp: string[]
  /** Beta adds beta app and content versions to what Lucent offers; Stable is the default. */
  channel: Channel
  /** How Launch starts XIV, when the player chose; otherwise Lucent picks the usual way for the game folder. */
  launcher: LaunchKind | null
  /** The game folder the player picked by hand; Scan checks it before the auto-detected folders. */
  gameFolder: string | null
}

const DEFAULTS: Settings = { skippedContent: [], skippedApp: [], channel: 'stable', launcher: null, gameFolder: null }

const settingsPath = async (platform: Platform) => joinPath(await platform.envFolder('LocalAppData'), 'Lucent', 'settings.json')

/** A missing or damaged settings file reads as the defaults: at worst a skipped version is announced again. */
export async function readSettings(platform: Platform): Promise<Settings> {
  const path = await settingsPath(platform)
  if (!await maybeStat(platform, path)) return { ...DEFAULTS }
  try {
    const value = JSON.parse(await platform.readText(path)) as Partial<Settings> | null
    const strings = (list: unknown) => Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []
    return { ...DEFAULTS, skippedContent: strings(value?.skippedContent), skippedApp: strings(value?.skippedApp), channel: value?.channel === 'beta' ? 'beta' : 'stable',
      launcher: value?.launcher === 'xivlauncher' || value?.launcher === 'steam' || value?.launcher === 'official' ? value.launcher : null,
      gameFolder: typeof value?.gameFolder === 'string' && value.gameFolder ? value.gameFolder : null }
  } catch { return { ...DEFAULTS } }
}

export async function writeSettings(platform: Platform, settings: Settings): Promise<void> {
  await platform.writeText(await settingsPath(platform), JSON.stringify(settings, null, 2))
}
