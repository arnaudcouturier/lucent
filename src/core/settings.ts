// The player's settings, in Lucent's data folder. They belong to the player, not to one game folder.
import { PlatformError, type Platform } from './platform'
import { joinPath } from './paths'
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
  /** Never stored: these are the defaults because the file is there but couldn't be read, so they must not be saved over it. */
  unreadable?: true
}

const DEFAULTS: Settings = { skippedContent: [], skippedApp: [], channel: 'stable', launcher: null, gameFolder: null, lastUpdateCheck: null }

const settingsPath = async (platform: Platform) => joinPath(await platform.envFolder('LocalAppData'), 'Lucent', 'settings.json')

/** Another program (an antivirus scan, a backup) can hold the file for a moment. */
const READ_ATTEMPTS = 3
const RETRY_MS = 50

/** The file's text, or null when there is none to keep: missing, or not text at all. Throws while Windows won't let Lucent read it. */
async function readSettingsText(platform: Platform, path: string): Promise<string | null> {
  for (let attempt = 1; ; attempt++) {
    try { return await platform.readText(path) }
    catch (error) {
      if (!(error instanceof PlatformError) || (error.kind !== 'locked' && error.kind !== 'access-denied')) return null
      if (attempt >= READ_ATTEMPTS) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
    }
  }
}

/**
 * A missing or damaged settings file reads as the defaults: at worst a skipped version is announced again. A file that
 * can't be read reads as the defaults too, marked so that a change made from them never replaces what it holds.
 */
export async function readSettings(platform: Platform): Promise<Settings> {
  const path = await settingsPath(platform)
  let text: string | null
  try { text = await readSettingsText(platform, path) } catch { return { ...DEFAULTS, unreadable: true } }
  if (text === null) return { ...DEFAULTS }
  try {
    const value = JSON.parse(text) as Partial<Settings> | null
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
  if (settings.unreadable) throw new Error('Lucent couldn’t read its settings file, so it didn’t save over it. Close any program that may be using it, then try again.')
  await platform.writeText(await settingsPath(platform), JSON.stringify(settings, null, 2))
}
