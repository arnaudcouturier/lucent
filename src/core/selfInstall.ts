// Self-install: Lucent copies itself into its per-user folder and adds a Start menu shortcut and a
// Settings → Apps entry, all without admin. That folder is also the data folder, so the downloaded
// copy and the installed copy always see the same deployment.
import { PlatformError, type Platform } from './platform'
import { joinPath, normalizePath } from './paths'
import { maybeStat } from './deployment'

const ENTRY_ID = 'Lucent'
const ENTRY_KEY = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${ENTRY_ID}`
const REPOSITORY_URL = 'https://github.com/arnaudcouturier/lucent'

/** Lucent's per-user folder: the data folder, and where the installed exe lives. */
export const lucentFolder = async (platform: Platform) => joinPath(await platform.envFolder('LocalAppData'), 'Lucent')

async function installPaths(platform: Platform) {
  const folder = await lucentFolder(platform)
  const programs = joinPath(await platform.envFolder('AppData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  return { folder, exe: joinPath(folder, 'Lucent.exe'), shortcut: joinPath(programs, 'Lucent.lnk') }
}

const samePath = (a: string, b: string) => normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase()

/** Installed once Settings → Apps lists Lucent and the installed exe is in place. */
export async function isSelfInstalled(platform: Platform): Promise<boolean> {
  try { await platform.readRegistry('HKCU', ENTRY_KEY, 'DisplayName') } catch (error) {
    if (error instanceof PlatformError && error.kind === 'not-found') return false
    throw error
  }
  const { exe } = await installPaths(platform)
  return (await maybeStat(platform, exe))?.kind === 'file'
}

async function writeEntry(platform: Platform, appVersion: string) {
  const { folder, exe } = await installPaths(platform)
  const { size } = await platform.stat(exe)
  await platform.setUninstallEntry(ENTRY_ID, {
    DisplayName: 'Lucent', DisplayVersion: appVersion, Publisher: 'Lucent', DisplayIcon: exe, InstallLocation: folder,
    UninstallString: `"${exe}" --uninstall`, URLInfoAbout: REPOSITORY_URL, EstimatedSize: Math.ceil(size / 1024), NoModify: 1, NoRepair: 1,
  })
}

/** The entry comes last, so a failure part-way never lists Lucent in Settings → Apps. */
export async function selfInstall(platform: Platform, appVersion: string): Promise<void> {
  const { exe, shortcut } = await installPaths(platform)
  const running = await platform.exePath()
  if (!samePath(running, exe)) await platform.copyFile(running, exe)
  await platform.createShortcut(shortcut, exe)
  await writeEntry(platform, appVersion)
}

/** The installed copy rewrites its entry when it opens, so Settings → Apps shows the version an app update brought. */
export async function refreshSelfInstall(platform: Platform, appVersion: string): Promise<void> {
  const { exe } = await installPaths(platform)
  if (samePath(await platform.exePath(), exe)) await writeEntry(platform, appVersion)
}

/** Removes the shortcut and the entry. The data folder and the exe in it go once Lucent exits. */
export async function removeSelfInstall(platform: Platform): Promise<void> {
  const { shortcut } = await installPaths(platform)
  if (await maybeStat(platform, shortcut)) await platform.removeFile(shortcut)
  await platform.removeUninstallEntry(ENTRY_ID)
}
