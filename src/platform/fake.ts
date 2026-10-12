// In-memory fake of the Platform port, with Windows semantics:
// paths are case-insensitive and accept either slash, and a folder exists when a file lives under it.
// Used by the core's tests, the state gallery and the app running in a browser.
import { PlatformError, type EnvFolder, type FileStat, type GpuAdapter, type LocalContent, type Platform, type RegistryHive } from '../core/platform'
import { assertGamePath } from '../shared/manifest'

/** A machine to fake: its files, registry and well-known folders. */
export interface Machine {
  files?: Record<string, string>
  /** Full key path (hive included, e.g. `HKLM\SOFTWARE\...`) → its string values. */
  registry?: Record<string, Record<string, string>>
  env?: Partial<Record<EnvFolder, string>>
  gpus?: GpuAdapter[]
  remoteText?: Record<string, string>
  devContent?: LocalContent | null
  gameRunning?: boolean
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
  readonly downloads: string[]
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
  const downloads: string[] = []
  const picks: (string | null)[] = []
  let gate: Promise<void> = Promise.resolve()
  let open = () => {}

  const isDenied = (p: string) => denied.some((d) => p === d || p.startsWith(d + '\\'))
  const isDir = (p: string) => [...files.keys()].some((f) => f.startsWith(p + '\\'))
  const writable = (path: string) => {
    const p = norm(path)
    if (isDenied(p)) throw new PlatformError('access-denied', `Access is denied: ${path}`, path)
    if (isDir(p)) throw new PlatformError('access-denied', `Is a folder: ${path}`, path)
    return p
  }

  return {
    downloads,
    async writeText(path, text) { await gate; files.set(writable(path), text) },
    async copyFile(from, to, replace = true) {
      const text = await this.readText(from)
      const target = writable(to)
      if (!replace && files.has(target)) throw new PlatformError('access-denied', `Protecting a file that appeared since Review: ${to}`, to)
      files.set(target, text)
    },
    async renameFile(from, to, replace = true) {
      const text = await this.readText(from)
      const source = writable(from)
      const target = writable(to)
      if (!replace && files.has(target)) throw new PlatformError('access-denied', `Protecting a file that appeared since Review: ${to}`, to)
      files.set(target, text)
      files.delete(source)
    },
    async removeFile(path) { await gate; files.delete(writable(path)) },
    async listFiles(root) {
      await gate
      const p = norm(root)
      if (isDenied(p)) throw new PlatformError('access-denied', `Access is denied: ${root}`, root)
      return [...files.keys()].filter((f) => f.startsWith(p + '\\')).map((f) => f.slice(p.length + 1))
    },
    async hashFile(path) {
      const bytes = new TextEncoder().encode(await this.readText(path))
      const hash = await crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
    },
    async resolveGamePath(root, relative) {
      await gate
      assertGamePath(relative)
      return `${root.replace(/[\\/]$/, '')}\\${relative.replace(/\//g, '\\')}`
    },
    async downloadFile(url, to, progress) {
      await gate
      downloads.push(url)
      const text = await this.fetchText(url)
      progress(new TextEncoder().encode(text).length)
      await this.writeText(to, text)
    },
    async isGameRunning() { await gate; return machine.gameRunning ?? false },
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
    async getGpuAdapters() {
      await gate
      return (machine.gpus ?? []).map((gpu) => ({ ...gpu }))
    },
    async fetchText(url) {
      await gate
      const text = machine.remoteText?.[url]
      if (text === undefined) throw new PlatformError('network', `Could not fetch ${url}`)
      return text
    },
    async getDevContent() {
      await gate
      return machine.devContent ? { ...machine.devContent } : null
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
