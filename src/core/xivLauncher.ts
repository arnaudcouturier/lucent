// XIVLauncher: its config names the game folder, and its add-on list can run Lucent when the game launches and closes.
import { HEADLESS_FLAGS, PlatformError, type HeadlessMode, type Platform } from './platform'
import { joinPath } from './paths'

export type XivLauncherState =
  | { status: 'idle' | 'scanning' }
  | { status: 'found'; configPath: string; autoRepair: boolean }
  | { status: 'not-found' }
  | { status: 'unavailable'; message: string }

export const XIVLAUNCHER_EXE = 'XIVLauncher.exe'

export async function xivLauncherConfigPath(platform: Platform): Promise<string> {
  return joinPath(await platform.envFolder('AppData'), 'XIVLauncher', 'launcherConfigV3.json')
}

/** The game folder XIVLauncher launches, or null when its config names none. */
export async function xivLauncherGamePath(platform: Platform): Promise<string | null> {
  const config = JSON.parse(await platform.readText(await xivLauncherConfigPath(platform)))
  return typeof config?.GamePath === 'string' ? config.GamePath : null
}

export async function scanXivLauncher(platform: Platform): Promise<XivLauncherState> {
  try {
    const configPath = await xivLauncherConfigPath(platform)
    if ((await platform.stat(configPath)).kind !== 'file') return { status: 'not-found' }
    // A config Lucent can't read still means XIVLauncher is installed; auto-repair just reads as off,
    // as it does when the player disabled Lucent's entries in XIVLauncher.
    const autoRepair = await readConfig(platform, configPath).then(({ addons }) => addons.some((a) => isLucentAddon(a) && (a as Partial<AddonEntry>).IsEnabled !== false), () => false)
    return { status: 'found', configPath, autoRepair }
  } catch (error) {
    if (error instanceof PlatformError && error.kind === 'not-found') return { status: 'not-found' }
    return { status: 'unavailable', message: error instanceof Error ? error.message : String(error) }
  }
}

/** XIVLauncher's `AddonEntry` holding a `GenericAddon`, as Newtonsoft serializes them: no type discriminator. */
interface AddonEntry {
  IsEnabled: boolean
  Addon: { Path: string; CommandLine: string; RunAsAdmin: boolean; RunOnClose: boolean; KillAfterClose: boolean }
}

/** Lucent's entries are recognized by their flags, so they are still found after the exe moves. */
const isLucentAddon = (entry: unknown) =>
  Object.values(HEADLESS_FLAGS).includes((entry as Partial<AddonEntry> | null)?.Addon?.CommandLine?.trim() ?? '')

/** `AddonList` is a JSON string inside the JSON config; XIVLauncher treats a missing one as empty. */
async function readConfig(platform: Platform, configPath: string) {
  const text = await platform.readText(configPath)
  const config = JSON.parse(text) as Record<string, unknown> | null
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Unexpected config layout.')
  const addons: unknown = config.AddonList == null ? [] : JSON.parse(String(config.AddonList))
  if (!Array.isArray(addons)) throw new Error('Unexpected add-on list layout.')
  return { text, config, addons }
}

const lucentAddon = (mode: HeadlessMode, exePath: string, runAsAdmin: boolean): AddonEntry => ({
  IsEnabled: true,
  Addon: { Path: exePath, CommandLine: HEADLESS_FLAGS[mode], RunAsAdmin: runAsAdmin, RunOnClose: mode === 'repair', KillAfterClose: false },
})

/**
 * Adds or removes Lucent's two add-on entries: a check when the game launches, and a repair once it closes.
 * XIVLauncher rewrites its whole config on every setting change, so it's edited only while XIVLauncher is closed.
 * Every other add-on and setting is kept as it was.
 */
export async function setAutoRepair(platform: Platform, configPath: string, options: { enabled: boolean; exePath: string; runAsAdmin: boolean }): Promise<void> {
  if (await platform.isProcessRunning(XIVLAUNCHER_EXE)) throw new Error('Close XIVLauncher, then try again. Lucent changes its add-ons only while it’s closed.')
  let read: Awaited<ReturnType<typeof readConfig>>
  try { read = await readConfig(platform, configPath) }
  catch { throw new Error('Lucent couldn’t read XIVLauncher’s add-on list, so it left it unchanged.') }
  const addons = read.addons.filter((a) => !isLucentAddon(a))
  if (options.enabled) addons.push(lucentAddon('check', options.exePath, options.runAsAdmin), lucentAddon('repair', options.exePath, options.runAsAdmin))
  const newline = read.text.includes('\r\n') ? '\r\n' : '\n'
  const text = JSON.stringify({ ...read.config, AddonList: JSON.stringify(addons) }, null, 2).replace(/\n/g, newline)
  await platform.writeText(configPath, /\r?\n$/.test(read.text) ? text + newline : text)
}

/**
 * Takes Lucent's add-ons out of XIVLauncher when Lucent is uninstalled. Returns a note when they're left behind,
 * and never throws: a stale entry must not stop the uninstall.
 */
export async function removeXivLauncherAddons(platform: Platform): Promise<string | null> {
  try {
    const configPath = await xivLauncherConfigPath(platform)
    if (!(await readConfig(platform, configPath)).addons.some(isLucentAddon)) return null
    if (await platform.isProcessRunning(XIVLAUNCHER_EXE)) return 'XIVLauncher was running, so Lucent’s two add-ons are still in its list. Remove them in XIVLauncher’s settings under Addons.'
    await setAutoRepair(platform, configPath, { enabled: false, exePath: '', runAsAdmin: false })
    return null
  } catch (error) {
    // No XIVLauncher is nothing to clean up; an unreadable config is left alone, as setAutoRepair does.
    if (error instanceof PlatformError && error.kind === 'not-found') return null
    return 'Lucent couldn’t remove its add-ons from XIVLauncher. Remove them in XIVLauncher’s settings under Addons.'
  }
}
