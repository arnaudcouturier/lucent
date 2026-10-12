// In-memory fake of the Platform port, with Windows semantics:
// paths are case-insensitive and accept either slash, and a folder exists when a file lives under it.
// Used by the core's tests, the state gallery and the app running in a browser.
import { PlatformError, type EnvFolder, type FileStat, type Platform, type RegistryHive } from '../core/platform'

/** A machine to fake: its files, registry and well-known folders. */
export interface Machine {
  files?: Record<string, string>
  /** Full key path (hive included, e.g. `HKLM\SOFTWARE\...`) → its string values. */
  registry?: Record<string, Record<string, string>>
  env?: Partial<Record<EnvFolder, string>>
}

export const DEFAULT_ENV: Record<EnvFolder, string> = {
  AppData: 'C:\\Users\\Player\\AppData\\Roaming',
  LocalAppData: 'C:\\Users\\Player\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  ProgramFilesX86: 'C:\\Program Files (x86)',
}

const norm = (path: string) =>
  path.replace(/\//g, '\\').replace(/\\{2,}/g, '\\').replace(/\\$/, '').toLowerCase()

export interface FakePlatform extends Platform {
  /** Queues the folder the player will pick next, or null for a cancel. With nothing queued, the player cancels. */
  answerPicker(path: string | null): void
  /** Makes reads of a path (and everything under it) fail with access denied. */
  deny(path: string): void
  /** Holds every call until `release()`, to observe in-flight states. */
  hold(): void
  release(): void
}

export function createFakePlatform(machine: Machine = {}): FakePlatform {
  const files = new Map<string, string>()
  for (const [path, content] of Object.entries(machine.files ?? {})) files.set(norm(path), content)
  const registry = new Map<string, Map<string, string>>()
  for (const [key, values] of Object.entries(machine.registry ?? {})) {
    registry.set(norm(key), new Map(Object.entries(values).map(([name, v]) => [name.toLowerCase(), v])))
  }
  const env = { ...DEFAULT_ENV, ...machine.env }
  const denied: string[] = []
  const picks: (string | null)[] = []
  let gate: Promise<void> = Promise.resolve()
  let open = () => {}

  const isDenied = (p: string) => denied.some((d) => p === d || p.startsWith(d + '\\'))
  const isDir = (p: string) => [...files.keys()].some((f) => f.startsWith(p + '\\'))

  return {
    async readText(path) {
      await gate
      const p = norm(path)
      if (isDenied(p)) throw new PlatformError('access-denied', `Access is denied: ${path}`, path)
      const content = files.get(p)
      if (content !== undefined) return content
      if (isDir(p)) throw new PlatformError('access-denied', `Is a folder: ${path}`, path)
      throw new PlatformError('not-found', `Not found: ${path}`, path)
    },
    async stat(path): Promise<FileStat> {
      await gate
      const p = norm(path)
      const content = files.get(p)
      if (content !== undefined) return { kind: 'file', size: new TextEncoder().encode(content).length, modifiedMs: 0 }
      if (isDir(p)) return { kind: 'dir', size: 0, modifiedMs: 0 }
      throw new PlatformError('not-found', `Not found: ${path}`, path)
    },
    async readRegistry(hive: RegistryHive, key, value) {
      await gate
      const found = registry.get(norm(`${hive}\\${key}`))?.get(value.toLowerCase())
      if (found === undefined) throw new PlatformError('not-found', `No registry value ${hive}\\${key}\\${value}`)
      return found
    },
    async envFolder(folder) {
      await gate
      return env[folder]
    },
    async pickFolder() {
      await gate
      return picks.length ? picks.shift()! : null
    },
    answerPicker(path) {
      picks.push(path)
    },
    deny(path) {
      denied.push(norm(path))
    },
    hold() {
      gate = new Promise((resolve) => (open = resolve))
    },
    release() {
      open()
    },
  }
}
