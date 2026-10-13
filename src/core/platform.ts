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
}

export type RegistryHive = 'HKCU' | 'HKLM'

/** Well-known folders, as Windows resolves them for the current user. */
export type EnvFolder = 'AppData' | 'LocalAppData' | 'ProgramFiles' | 'ProgramFilesX86'

export interface GpuAdapter {
  name: string
  vendorId: number
  /** Dedicated video memory in bytes, excluding shared system memory. */
  dedicatedMemory: number
  software: boolean
  /** Windows driver version; absent if the adapter cannot report it. */
  driverVersion?: string | null
}

/** Available only in dev builds; local release files live under filesDirectory. */
export interface LocalContent {
  manifestPath: string
  filesDirectory: string
}

export interface Platform {
  /** Reads a UTF-8 text file. */
  readText(path: string): Promise<string>
  /** Reads only the final lines of a potentially large log, without its terminal newline. */
  readTextTail(path: string, maxLines: number): Promise<string>
  getWindowsVersion(): Promise<string>
  copyText(text: string): Promise<void>
  openUrl(url: string): Promise<void>
  stat(path: string): Promise<FileStat>
  /** Reads a string value. `key` is the full subkey path under the hive. */
  readRegistry(hive: RegistryHive, key: string, value: string): Promise<string>
  envFolder(folder: EnvFolder): Promise<string>
  /** Asks the player to pick a folder. Resolves to null if they cancel. */
  pickFolder(options: { title: string }): Promise<string | null>
  getGpuAdapters(): Promise<GpuAdapter[]>
  /** Fetches UTF-8 text; HTTP errors are port failures, never document contents. */
  fetchText(url: string): Promise<string>
  getDevContent(): Promise<LocalContent | null>
  /** Atomic, durable replacement; readers see either the old or the complete new file. */
  writeText(path: string, text: string, stagingDirectory?: string): Promise<void>
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
  hashFile(path: string): Promise<string>
  /** Resolves a relative path, rejecting traversal and reparse points in every existing ancestor. */
  resolveGamePath(root: string, relative: string): Promise<string>
  /** Streams to a temporary file and atomically commits it when complete. */
  downloadFile(url: string, to: string, progress: (received: number) => void): Promise<void>
  isGameRunning(): Promise<boolean>
  /** The running Lucent exe, which an app update renames aside and replaces. */
  exePath(): Promise<string>
  /** Starts the exe at `path`; the real port then exits this process so the new one takes over. */
  launchExe(path: string): Promise<void>
}
