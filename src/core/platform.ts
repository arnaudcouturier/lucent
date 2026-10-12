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

export interface Platform {
  /** Reads a UTF-8 text file. */
  readText(path: string): Promise<string>
  stat(path: string): Promise<FileStat>
  /** Reads a string value. `key` is the full subkey path under the hive. */
  readRegistry(hive: RegistryHive, key: string, value: string): Promise<string>
  envFolder(folder: EnvFolder): Promise<string>
  /** Asks the player to pick a folder. Resolves to null if they cancel. */
  pickFolder(options: { title: string }): Promise<string | null>
}
