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
  /** The last update check where both sources loaded, including what was available on that channel. */
  lastUpdateCheck: { checkedAt: string; channel: Channel; appVersion: string | null; contentVersion: string | null } | null
}

const DEFAULTS: Settings = { skippedContent: [], skippedApp: [], channel: 'stable', launcher: null, gameFolder: null, lastUpdateCheck: null }

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
      gameFolder: typeof value?.gameFolder === 'string' && value.gameFolder ? value.gameFolder : null,
      lastUpdateCheck: value?.lastUpdateCheck && typeof value.lastUpdateCheck === 'object'
        && typeof value.lastUpdateCheck.checkedAt === 'string' && Number.isFinite(Date.parse(value.lastUpdateCheck.checkedAt))
        ? { checkedAt: value.lastUpdateCheck.checkedAt, channel: value.lastUpdateCheck.channel === 'beta' ? 'beta' : 'stable',
          appVersion: typeof value.lastUpdateCheck.appVersion === 'string' ? value.lastUpdateCheck.appVersion : null,
          contentVersion: typeof value.lastUpdateCheck.contentVersion === 'string' ? value.lastUpdateCheck.contentVersion : null }
        : null }
  } catch { return { ...DEFAULTS } }
}

export async function writeSettings(platform: Platform, settings: Settings): Promise<void> {
  await platform.writeText(await settingsPath(platform), JSON.stringify(settings, null, 2))
}
