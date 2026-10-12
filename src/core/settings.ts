// The player's settings, in Lucent's data folder. They belong to the player, not to one game folder.
import type { Platform } from './platform'
import { joinPath } from './paths'
import { maybeStat } from './deployment'

export interface Settings {
  /** Content versions the player skipped; they are no longer announced. */
  skippedContent: string[]
}

const DEFAULTS: Settings = { skippedContent: [] }

const settingsPath = async (platform: Platform) => joinPath(await platform.envFolder('LocalAppData'), 'Lucent', 'settings.json')

/** A missing or damaged settings file reads as the defaults: at worst a skipped version is announced again. */
export async function readSettings(platform: Platform): Promise<Settings> {
  const path = await settingsPath(platform)
  if (!await maybeStat(platform, path)) return { ...DEFAULTS }
  try {
    const value = JSON.parse(await platform.readText(path)) as Partial<Settings> | null
    const skipped = Array.isArray(value?.skippedContent) ? value.skippedContent.filter((id): id is string => typeof id === 'string') : []
    return { ...DEFAULTS, skippedContent: skipped }
  } catch { return { ...DEFAULTS } }
}

export async function writeSettings(platform: Platform, settings: Settings): Promise<void> {
  await platform.writeText(await settingsPath(platform), JSON.stringify(settings, null, 2))
}
