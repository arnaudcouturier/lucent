// In-memory fake of the Platform port, with Windows semantics:
// paths are case-insensitive and accept either slash, and a folder exists when a file lives under it.
// Used by the core's tests, the state gallery and the app running in a browser.
import { PlatformError, type EnvFolder, type FileStat, type GpuAdapter, type HeadlessMode, type LocalContent, type MonitorInfo, type Platform, type RegistryHive } from '../core/platform'
import { assertGamePath } from '../shared/manifest'

/** A machine to fake: its files, registry and well-known folders. */
export interface Machine {
  files?: Record<string, string>
  directories?: string[]
  /** Full key path (hive included, e.g. `HKLM\SOFTWARE\...`) → its string values. */
  registry?: Record<string, Record<string, string>>
  env?: Partial<Record<EnvFolder, string>>
  gpus?: GpuAdapter[]
  monitors?: MonitorInfo[]
  remoteText?: Record<string, string>
  devContent?: LocalContent | null
  gameRunning?: boolean
  /** Exe names of other running processes, such as `XIVLauncher.exe`. */
  processes?: string[]
  /** The headless run this process was started for. */
  headlessMode?: 'uninstall' | HeadlessMode | null
  readOnlyDirectories?: string[]
  /** Files carrying the Windows read-only flag; Lucent clears it on a file it must replace or remove. */
  readOnlyFiles?: string[]
  elevated?: boolean
  elevationCancelled?: boolean
  elevationResumePath?: string | null
  /** The running Lucent exe on this machine; an app update renames and replaces this file. */
  exePath?: string
  windowsVersion?: string
  /** Share this set between simulated processes to model leases for the same player's data folder. */
  operationLocks?: Set<string>
  /** How Settings → Apps started this exe; null or absent for the main window. */
}

export const DEFAULT_ENV: Record<EnvFolder, string> = {
  Documents: 'C:\\Users\\Player\\Documents',
  AppData: 'C:\\Users\\Player\\AppData\\Roaming',
  LocalAppData: 'C:\\Users\\Player\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  ProgramFilesX86: 'C:\\Program Files (x86)',
}

const norm = (path: string) =>
  path.replace(/\//g, '\\').replace(/\\{2,}/g, '\\').replace(/\\$/, '').toLowerCase()

export const FAKE_EXE_PATH = 'C:\\Users\\Player\\Downloads\\Lucent.exe'
const uninstallKey = (id: string) => norm(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${id}`)

export interface FakePlatform extends Platform {
  readonly elevationRequests: string[]
  readonly downloads: string[]
  /** Every exe the fake was asked to launch, in order; the real port exits instead of returning. */
  readonly launched: string[]
  /** Programs started and Steam games opened, as `steam://rungameid/<id>`, in order. */
  readonly started: string[]
  readonly clipboard: string | null
  readonly openedUrls: string[]
  /** Every Windows notification shown, in order. */
  readonly notifications: { title: string; body: string }[]
  readonly exited: boolean
  /** The folders the last exit was asked to remove; null while Lucent is running. */
  readonly removedOnExit: string[] | null
  listDirectories(root: string): Promise<string[]>
  /** Queues the folder the player will pick next, or null for a cancel. With nothing queued, the player cancels. */
  answerPicker(path: string | null): void
  /** Makes reads of a path (and everything under it) fail with access denied. */
  deny(path: string): void
  /** Sets a file's last-write time, as a tool that preserves timestamps would. */
  setModifiedTime(path: string, modifiedMs: number): void
  /** Holds every call until `release()`, to observe in-flight states. */
  hold(): void
  release(): void
  /** Simulates process death: releases its OS leases while preserving its machine's files for recovery. */
  crash(): void
}

export function createFakePlatform(machine: Machine = {}): FakePlatform {
  const files = new Map<string, string>()
  // Windows keeps a file's last-write time through copy and rename; only a write gives it a new one.
  const modified = new Map<string, number>()
  let clock = 1_700_000_000_000
  const touch = (path: string) => modified.set(path, ++clock)
  const directories = new Set((machine.directories ?? []).map(norm))
  const addParents = (path: string) => {
    let parent = norm(path).slice(0, norm(path).lastIndexOf('\\'))
    while (parent.includes('\\')) {
      directories.add(parent)
      parent = parent.slice(0, parent.lastIndexOf('\\'))
    }
  }
  for (const directory of machine.directories ?? []) addParents(directory)
  for (const [path, content] of Object.entries(machine.files ?? {})) { files.set(norm(path), content); addParents(path) }
  // Like a real machine, the running exe exists.
  const runningExe = machine.exePath ?? FAKE_EXE_PATH
  if (!files.has(norm(runningExe))) { files.set(norm(runningExe), 'Lucent 0.1.0'); addParents(runningExe) }
  const registry = new Map<string, Map<string, string>>()
  for (const [key, values] of Object.entries(machine.registry ?? {})) {
    registry.set(norm(key), new Map(Object.entries(values).map(([name, v]) => [name.toLowerCase(), v])))
  }
  const env = { ...DEFAULT_ENV, ...machine.env }
  const denied: string[] = []
  const downloads: string[] = []
  const launched: string[] = []
  const started: string[] = []
  let clipboard: string | null = null
  const openedUrls: string[] = []
  const notifications: { title: string; body: string }[] = []
  let exited = false
  const elevationRequests: string[] = []
  let removedOnExit: string[] | null = null
  const picks: (string | null)[] = []
  let gate: Promise<void> = Promise.resolve()
  let open = () => {}
  const operationLocks = machine.operationLocks ?? new Set<string>()
  const operationLeases = new Map<string, string>()
  const endedOperationLeases = new Set<string>()
  const releaseProcessLocks = () => {
    for (const [token, folder] of operationLeases) { operationLocks.delete(folder); endedOperationLeases.add(token) }
    operationLeases.clear()
  }

  const isDenied = (p: string) => denied.some((d) => p === d || p.startsWith(d + '\\'))
  const isDir = (p: string) => directories.has(p)
  const isReadOnly = (p: string) => !machine.elevated && (machine.readOnlyDirectories ?? []).some((path) => p === norm(path) || p.startsWith(norm(path) + '\\'))
  const readOnlyFiles = new Set((machine.readOnlyFiles ?? []).map(norm))
  const writable = (path: string) => {
    const p = norm(path)
    if (isDenied(p) || isReadOnly(p)) throw new PlatformError('access-denied', `Access is denied: ${path}`, path)
    if (isDir(p)) throw new PlatformError('access-denied', `Is a folder: ${path}`, path)
    // The real port clears a destination's read-only flag before replacing or removing it.
    readOnlyFiles.delete(p)
    return p
  }

  return {
    downloads,
    elevationRequests,
    launched,
    started,
    get clipboard() { return clipboard },
    openedUrls,
    notifications,
    get exited() { return exited },
    get removedOnExit() { return removedOnExit },
    async getWindowsVersion() { await gate; return machine.windowsVersion ?? 'Windows 11 24H2 (build 26100.2033)' },
    async getKeyNames() { return {} },
    async copyText(text) { await gate; clipboard = text },
    async openUrl(url) { await gate; openedUrls.push(url) },
    async readTextTail(path, maxLines) {
      if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 10000) throw new PlatformError('unknown', 'Line count must be between 1 and 10000', path)
      const text = await this.readText(path)
      return text.replace(/\r?\n$/, '').split(/\r?\n/).slice(-maxLines).join('\n')
    },
    async writeText(path, text) { await gate; const target = writable(path); addParents(target); files.set(target, text); touch(target) },
    async appendText(path, text) { await gate; const target = writable(path); addParents(target); files.set(target, (files.get(target) ?? '') + text); touch(target) },
    async writeFileByte(path, offset, value) {
      const text = await this.readText(path)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= text.length || value < 0 || value > 127) throw new PlatformError('unknown', 'Invalid byte write', path)
      files.set(writable(path), text.slice(0, offset) + String.fromCharCode(value) + text.slice(offset + 1))
      touch(norm(path))
    },
    async copyFile(from, to, replace = true) {
      const text = await this.readText(from)
      const target = writable(to)
      if (!replace && files.has(target)) throw new PlatformError('access-denied', `Protecting a file that appeared since Review: ${to}`, to)
      addParents(target)
      files.set(target, text)
      modified.set(target, modified.get(norm(from)) ?? 0)
    },
    async renameFile(from, to, replace = true) {
      const text = await this.readText(from)
      const source = writable(from)
      const target = writable(to)
      if (!replace && files.has(target)) throw new PlatformError('access-denied', `Protecting a file that appeared since Review: ${to}`, to)
      addParents(target)
      files.set(target, text)
      modified.set(target, modified.get(source) ?? 0)
      files.delete(source)
    },
    async removeFile(path) { await gate; files.delete(writable(path)) },
    // The batches go through the single-file methods, so a test that replaces one of those sees every batched call.
    async resolveGamePaths(root, relatives) { const out: string[] = []; for (const r of relatives) out.push(await this.resolveGamePath(root, r)); return out },
    async statMany(paths) {
      const out: (FileStat | null)[] = []
      for (const path of paths) {
        try { out.push(await this.stat(path)) } catch (error) { if (error instanceof PlatformError && error.kind === 'not-found') out.push(null); else throw error }
      }
      return out
    },
    async hashMany(paths) { const out: string[] = []; for (const path of paths) out.push(await this.hashFile(path)); return out },
    async copyMany(items, stagingDirectory) { for (const { from, to, replace } of items) await this.copyFile(from, to, replace, stagingDirectory) },
    async removeMany(paths) { for (const path of paths) await this.removeFile(path) },
    async writeFileBytes(path, offsets, value) { for (const offset of offsets) await this.writeFileByte(path, offset, value) },
    async removeDirectoriesIfEmpty(paths) { for (const path of paths) await this.removeDirectoryIfEmpty(path) },
    async removeDirectoryIfEmpty(path) {
      await gate
      const p = norm(path)
      if (isDenied(p) || files.has(p)) throw new PlatformError('access-denied', `The folder cannot be removed: ${path}`, path)
      if (![...directories, ...files.keys()].some((child) => child.startsWith(p + '\\'))) directories.delete(p)
    },
    async listDirectories(root) {
      await gate
      const p = norm(root)
      return [...directories].filter((d) => d.startsWith(p + '\\')).map((d) => d.slice(p.length + 1))
    },
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
    async isProcessRunning(exeName) {
      await gate
      const running = [...(machine.processes ?? []), ...(machine.gameRunning ? ['ffxiv_dx11.exe'] : [])]
      return running.some((name) => name.toLowerCase() === exeName.toLowerCase())
    },
    async notify(title, body) { await gate; notifications.push({ title, body }) },
    async exit() { releaseProcessLocks(); exited = true },
    async isDirectoryWritable(path, targets = []) {
      await gate
      for (const target of targets) assertGamePath(target)
      return [path, ...targets.map((target) => `${path}\\${target}`)].every((target) => !isDenied(norm(target)) && !isReadOnly(norm(target)))
    },
    async isElevated() { await gate; return machine.elevated ?? false },
    async getElevationResumePath() { await gate; return machine.elevationResumePath ?? null },
    async requestElevation(path) {
      await gate
      elevationRequests.push(path)
      if (machine.elevationCancelled) throw new PlatformError('cancelled', 'Administrator access was cancelled.')
      machine.elevationResumePath = path
      releaseProcessLocks()
    },
    async exePath() { await gate; return machine.exePath ?? FAKE_EXE_PATH },
    async launchExe(path) { await gate; launched.push(path); releaseProcessLocks() },
    async startProgram(path) {
      await gate
      if (!files.has(norm(path))) throw new PlatformError('not-found', `Not found: ${path}`, path)
      started.push(path)
    },
    async openSteamGame(appId) { await gate; started.push(`steam://rungameid/${appId}`) },
    async createShortcut(path, target) { await this.writeText(path, `Shortcut to ${target}`) },
    async setUninstallEntry(id, values) {
      await gate
      const key = uninstallKey(id)
      const entry = registry.get(key) ?? new Map<string, string>()
      for (const [name, value] of Object.entries(values)) entry.set(name.toLowerCase(), String(value))
      registry.set(key, entry)
    },
    async removeUninstallEntry(id) { await gate; registry.delete(uninstallKey(id)) },
    async headlessMode() { await gate; return machine.headlessMode ?? null },
    // The real port exits here; the fake removes the folders at once and keeps running.
    async exitAndRemove(folders) {
      await gate
      releaseProcessLocks()
      for (const folder of folders.map(norm)) {
        for (const path of [...files.keys()]) if (path.startsWith(folder + '\\')) files.delete(path)
        for (const path of [...directories]) if (path === folder || path.startsWith(folder + '\\')) directories.delete(path)
      }
      removedOnExit = [...folders]
    },
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
      if (content !== undefined) return { kind: 'file', size: new TextEncoder().encode(content).length, modifiedMs: modified.get(p) ?? 0 }
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
    async getMonitors() {
      await gate
      return structuredClone(machine.monitors ?? [])
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
    async acquireOperationLock(dataFolder) {
      await gate
      if (!/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(dataFolder)) throw new PlatformError('unknown', 'Lucent data folder must be an absolute path', dataFolder)
      const folder = norm(dataFolder)
      const path = `${dataFolder}\\operation.lock`
      const file = writable(path)
      if (operationLocks.has(folder)) throw new PlatformError('locked', 'Another Lucent window is working with files. Try again when it finishes.', path)
      const token = crypto.randomUUID()
      operationLocks.add(folder)
      operationLeases.set(token, folder)
      if (!files.has(file)) { files.set(file, ''); addParents(path) }
      return token
    },
    async resetOperationLocks() {
      await gate
      // A fresh webview in the same process: this instance's leases are orphaned, other instances keep theirs.
      releaseProcessLocks()
    },
    async releaseOperationLock(token) {
      await gate
      const folder = operationLeases.get(token)
      if (folder === undefined) {
        // Native exit does not return; allow the fake's finally block to release its already ended lease.
        if (endedOperationLeases.delete(token)) return
        throw new PlatformError('unknown', 'Lucent operation lease is not held by this process.')
      }
      operationLocks.delete(folder)
      operationLeases.delete(token)
    },
    answerPicker(path) {
      picks.push(path)
    },
    deny(path) {
      denied.push(norm(path))
    },
    setModifiedTime(path, modifiedMs) {
      modified.set(norm(path), modifiedMs)
    },
    hold() {
      gate = new Promise((resolve) => (open = resolve))
    },
    release() {
      open()
    },
    crash() { releaseProcessLocks() },
  }
}
