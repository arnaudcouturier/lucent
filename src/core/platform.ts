// The Platform port: the core's only route to the machine.
// The real implementation is a set of Tauri commands (src-tauri), each one a dumb primitive.
// The fake (src/platform/fake.ts) implements the same port for tests, the state gallery and the browser.

/** The error kinds the core handles. Every port failure carries exactly one. */
export type PlatformErrorKind =
  | 'not-found'
  | 'access-denied'
  | 'locked' // locked by another process, such as the running game
  | 'disk-full'
  | 'network'
  | 'hash-mismatch'
  | 'cancelled'
  | 'unknown' // anything the port can't classify; the message says what happened

export class PlatformError extends Error {
  readonly kind: PlatformErrorKind
  readonly path?: string

  constructor(kind: PlatformErrorKind, message: string, path?: string) {
    super(message)
    this.name = 'PlatformError'
    this.kind = kind
    this.path = path
  }
}

export interface FileStat {
  kind: 'file' | 'dir'
  size: number
  modifiedMs: number
  /** The Windows read-only attribute. A replacement (`writeText`, `copyFile`, `renameFile`) or removal clears it. */
  readOnly: boolean
}

export interface CopyItem { from: string; to: string; replace: boolean }

export type RegistryHive = 'HKCU' | 'HKLM'

/** Well-known folders, as Windows resolves them for the current user. */
export type EnvFolder = 'Documents' | 'Pictures' | 'AppData' | 'LocalAppData' | 'ProgramFiles' | 'ProgramFilesX86'

export interface GpuAdapter {
  name: string
  vendorId: number
  /** Dedicated video memory in bytes, excluding shared system memory. */
  dedicatedMemory: number
  software: boolean
  /** Windows driver version; absent if the adapter cannot report it. */
  driverVersion?: string | null
  /** Where Windows ranks the adapter for high performance, 0 first: external, then discrete, then integrated GPUs. Absent when Windows can't rank them. */
  highPerformanceRank?: number
}

/** A desktop-attached display as Windows currently reports it. */
export interface MonitorInfo {
  deviceName: string
  bounds: { left: number; top: number; right: number; bottom: number }
  primary: boolean
  /** Exact where Windows reports it (119.88); 0 when it reports no usable rate. */
  refreshHz: number
  width: number
  height: number
  hdrSupported: boolean
  hdrOn: boolean
  peakNits: number | null
}

/** Available only in dev builds; local release files live under filesDirectory. */
export interface LocalContent {
  manifestPath: string
  filesDirectory: string
}

export interface Platform {
  /** Reads a UTF-8 text file, or a UTF-16 one that starts with its byte order mark. */
  readText(path: string): Promise<string>
  /** Reads only the final lines of a potentially large log, without its terminal newline. The real port reads at most 2 MB of it. */
  readTextTail(path: string, maxLines: number): Promise<string>
  getWindowsVersion(): Promise<string>
  /** Names virtual keys on the foreground window's keyboard layout; missing keys have no entry. */
  getKeyNames(virtualKeys: number[]): Promise<Record<number, string>>
  copyText(text: string): Promise<void>
  openUrl(url: string): Promise<void>
  stat(path: string): Promise<FileStat>
  /** Reads a string value. `key` is the full subkey path under the hive. */
  readRegistry(hive: RegistryHive, key: string, value: string): Promise<string>
  /** SID of the interactive player account, captured before any administrator relaunch. */
  currentUserSid(): Promise<string>
  /** Reads a per-game UserGpuPreferences string from that player's loaded user hive. */
  readUserGpuPreferences(userSid: string, executablePath: string): Promise<string | null>
  /** Writes or removes only this player's per-game UserGpuPreferences value. */
  writeUserGpuPreferences(userSid: string, executablePath: string, value: string | null): Promise<void>
  envFolder(folder: EnvFolder): Promise<string>
  /** Asks the player to pick a folder. Resolves to null if they cancel. */
  pickFolder(options: { title: string }): Promise<string | null>
  getGpuAdapters(): Promise<GpuAdapter[]>
  getMonitors(): Promise<MonitorInfo[]>
  /**
   * Fetches UTF-8 text; HTTP errors are port failures, never document contents. Redirects must stay on HTTPS and off
   * heliosphere.app, and a reply over 32 MB is refused; those refusals are `unknown`, not `network`.
   */
  fetchText(url: string): Promise<string>
  getDevContent(): Promise<LocalContent | null>
  /** Acquires an exclusive cross-process lease for this player's Lucent data folder; fails with `locked` while another operation holds it. */
  acquireOperationLock(dataFolder: string): Promise<string>
  /** Releases the lease; the native process also releases its leases on exit or crash. */
  releaseOperationLock(token: string): Promise<void>
  /** Drops every lease this process holds. Called once by a fresh webview (after a reload, the old context's leases are orphaned); another process's lease is untouched. */
  resetOperationLocks(): Promise<void>
  /** Atomic, durable replacement; readers see either the old or the complete new file. */
  writeText(path: string, text: string, stagingDirectory?: string): Promise<void>
  /** Appends to a text file in one write, creating the file and its folder when missing. For logs: nothing is flushed. */
  appendText(path: string, text: string): Promise<void>
  /** Durably changes an already allocated byte; refuses to extend the file. */
  writeFileByte(path: string, offset: number, value: number): Promise<void>
  /** `replace=false` atomically refuses a destination that appeared since the last check. */
  /** Game writes stage outside the game folder on the same volume, so a kill leaves no temporary game files. */
  copyFile(from: string, to: string, replace?: boolean, stagingDirectory?: string): Promise<void>
  renameFile(from: string, to: string, replace?: boolean): Promise<void>
  removeFile(path: string): Promise<void>
  /** Removes a directory only while it is empty; one holding anything, or already gone, is left as is. */
  removeDirectoryIfEmpty(path: string): Promise<void>
  listFiles(root: string): Promise<string[]>
  /** The names of `root`'s immediate subfolders, junctions included, sorted ignoring case; `not-found` when `root` is missing. */
  listFolders(root: string): Promise<string[]>
  /**
   * Unpacks a .zip into `to`, which must be missing or empty. Refuses an entry that would land outside `to` or is not a plain
   * file or folder, and leaves nothing behind when it fails.
   */
  extractZip(zip: string, to: string): Promise<void>
  hashFile(path: string): Promise<string>
  /** Resolves a relative path, rejecting traversal and reparse points in every existing ancestor. */
  resolveGamePath(root: string, relative: string): Promise<string>
  // Batches: one call for many files, run in parallel by the real port. A deployment touches a thousand files, and a
  // round trip per file cost more than the file work itself.
  /** `resolveGamePath` for many paths, in order. */
  resolveGamePaths(root: string, relatives: string[]): Promise<string[]>
  /** `stat` for many paths, in order; null where nothing exists. */
  statMany(paths: string[]): Promise<(FileStat | null)[]>
  hashMany(paths: string[]): Promise<string[]>
  /** `copyFile` for many items. After a failure no new copy starts, and the first failure is reported. */
  copyMany(items: CopyItem[], stagingDirectory?: string): Promise<void>
  removeMany(paths: string[]): Promise<void>
  /** `writeFileByte` at several offsets, with one flush. */
  writeFileBytes(path: string, offsets: number[], value: number): Promise<void>
  /** `removeDirectoryIfEmpty` for each path, in order. */
  removeDirectoriesIfEmpty(paths: string[]): Promise<void>
  /**
   * Streams to a temporary file and atomically commits it when complete. Redirects follow `fetchText`'s rules; a file over
   * 1 GB, or one still arriving after two hours, is refused as `unknown`, so the core doesn't retry it.
   */
  downloadFile(url: string, to: string, progress: (received: number) => void): Promise<void>
  isGameRunning(): Promise<boolean>
  /** Whether any process with this exe name (such as `XIVLauncher.exe`) is running, ignoring case. */
  isProcessRunning(exeName: string): Promise<boolean>
  /**
   * Whether a process other than this one runs the exe at `path`, compared by full path (case and slashes don't matter).
   * A process Lucent may not inspect counts as not running it.
   */
  isExeRunningElsewhere(path: string): Promise<boolean>
  /** Probes the directory and the given relative write targets without changing existing files. */
  isDirectoryWritable(path: string, targets?: string[]): Promise<boolean>
  isElevated(): Promise<boolean>
  /** The one-use resume file passed to an elevated relaunch, if any. */
  getElevationResumePath(): Promise<string | null>
  /** Shows Windows UAC, starts this exe with the resume file, then exits on success. */
  requestElevation(resumePath: string): Promise<void>
  /** The running Lucent exe, which an app update renames aside and replaces. */
  exePath(): Promise<string>
  /** Starts the exe at `path`; the real port then exits this process so the new one takes over. */
  launchExe(path: string): Promise<void>
  /** Starts a program from its own folder and keeps Lucent running. */
  startProgram(path: string): Promise<void>
  /** Asks Steam to start a game by its app id. */
  openSteamGame(appId: number): Promise<void>
  /** Creates or replaces a Windows shortcut (.lnk) at `path` that starts `target`. */
  createShortcut(path: string, target: string): Promise<void>
  /** Creates or updates this user's Settings → Apps entry `id`; strings and DWORD numbers, no admin. */
  setUninstallEntry(id: string, values: Record<string, string | number>): Promise<void>
  /** Removes this user's Settings → Apps entry `id`, and the registration `notify` makes for its toasts; a missing entry counts as removed. */
  removeUninstallEntry(id: string): Promise<void>
  /** How this exe was started: Settings → Apps' uninstall window, a XIVLauncher add-on's headless run, or null for the main window. */
  headlessMode(): Promise<'uninstall' | HeadlessMode | null>
  /** Exits Lucent; once its process has ended, removes these folders and everything in them. */
  exitAndRemove(folders: string[]): Promise<void>
  /** Shows a Windows notification from Lucent. */
  notify(title: string, body: string): Promise<void>
  /** Ends a headless run; the real port exits this process. */
  exit(): Promise<void>
}

/** `check` runs when the game launches; `repair` runs after it closes. */
export type HeadlessMode = 'check' | 'repair'

/** The command-line flags XIVLauncher's add-on entries pass to start a headless run. */
export const HEADLESS_FLAGS: Record<HeadlessMode, string> = { check: '--headless-check', repair: '--headless-repair' }
