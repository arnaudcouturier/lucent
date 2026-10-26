// What Lucent keeps on the PC apart from the game folder: the content cache and the player's readable backup copies. Settings'
// Storage card shows their sizes and clears either. Only these two folders are ever listed or emptied; the journal's own backups
// (`deployments\<id>\backups`), which Uninstall and recovery restore from, are never reachable from here.
import type { Platform } from './platform'
import { deploymentRecords, maybeStat } from './deployment'
import { isGameFolder } from './gameFolder'
import { lucentFolder } from './selfInstall'
import { joinPath } from './paths'
import { fileKey } from './planner'

/**
 * Why a folder of readable copies is there.
 * - `install`: the originals of a deployment still on its game folder; the journal restores them itself, so the copy is redundant.
 * - `reset`: what a Reset set aside; the journal's backups hold the same files.
 * - `kept`: originals a vanilla Uninstall left out, or of a game folder that is gone: the only copies of those files.
 * - `other`: a folder no deployment record names.
 */
export type BackupKind = 'install' | 'reset' | 'kept' | 'other'

/**
 * Only the install copy of a live deployment starts ticked in Clear backups: the journal holds the same files and Uninstall restores or
 * rewrites them from it. A Reset's copy, the only copies and any folder Lucent can't explain start unticked, since nothing in Lucent puts
 * a Reset's copy back: removing those is a deliberate extra tick.
 */
export const startsTicked = (kind: BackupKind) => kind === 'install'

export interface BackupGroup { folder: string; kind: BackupKind; files: number; bytes: number }

/** `unreadable`: the folder couldn't be listed (a link to somewhere else, a drive that is gone); it shows with no size and nothing to clear. */
export interface Storage {
  cache: { path: string; files: number; bytes: number; unreadable?: boolean }
  backups: { path: string; groups: BackupGroup[]; unreadable?: boolean }
}

/** `skipped`: folders asked for that were left, because they are no longer what the list said. */
export interface Cleared { files: number; bytes: number; skipped?: string[] }

/** The cache holds the hash-named assets and the `.tmp` files downloads stream into; `pruneContentCache` leaves other files alone too. */
const CACHE_FILE = /^(?:[a-f0-9]{64}|\.tmp[^\\/]*)$/i
/** The folder name a Reset gives its copy: `<game folder name> - Reset <ISO time with . and : as ->`. */
const RESET_COPY = / - Reset \d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}$/i

interface Listed { relative: string; path: string; bytes: number }

/**
 * The listed files that are safe to remove from `root`: each one is checked to stay under it. A name with `..`, an empty
 * part or a stream or wildcard character never reaches the Rust delete, which removes any path it is given.
 */
async function listed(platform: Platform, root: string, accept: (relative: string) => boolean): Promise<Listed[]> {
  // A folder that was never made has nothing; the real port refuses to list one.
  if (!await maybeStat(platform, root)) return []
  const prefix = `${fileKey(root)}/`
  const found = (await platform.listFiles(root)).flatMap((relative) => {
    const parts = relative.split(/[\\/]/)
    if (!accept(relative) || parts.some((part) => !part || part === '.' || part === '..' || /[:*?"<>|]/.test(part))) return []
    const path = joinPath(root, ...parts)
    return fileKey(path).startsWith(prefix) ? [{ relative: parts.join('\\'), path }] : []
  })
  const stats = await platform.statMany(found.map((file) => file.path))
  return found.flatMap((file, i) => stats[i]?.kind === 'file' ? [{ ...file, bytes: stats[i]!.size }] : [])
}

const total = (files: Listed[]): Cleared => ({ files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) })

const topFolder = (relative: string) => relative.split('\\')[0]

/** The folders of readable copies, each with why it is there. */
async function backupKinds(platform: Platform, folders: string[]): Promise<Map<string, BackupKind>> {
  const kinds = new Map<string, BackupKind>()
  const named = new Map<string, boolean>()
  try {
    for await (const record of deploymentRecords(platform)) {
      if (!record.backupFolder) continue
      const key = fileKey(record.backupFolder)
      const live = record.status === 'complete' && await isGameFolder(platform, record.gameFolder)
      named.set(key, (named.get(key) ?? false) || live)
    }
  } catch {
    // A record that can't be read leaves every deployment's install copy unexplained, so none is offered as redundant. A Reset's copy is known by its name alone.
    for (const folder of folders) kinds.set(fileKey(folder), RESET_COPY.test(folder) ? 'reset' : 'other')
    return kinds
  }
  for (const folder of folders) {
    const key = fileKey(folder)
    kinds.set(key, named.has(key) ? (named.get(key) ? 'install' : 'kept') : RESET_COPY.test(folder) ? 'reset' : 'other')
  }
  return kinds
}

const cacheFiles = async (platform: Platform, cache: string) => listed(platform, cache, (relative) => CACHE_FILE.test(relative))
const backupFiles = async (platform: Platform, backups: string) => listed(platform, backups, (relative) => relative.split(/[\\/]/).length > 1)

/** How much the cache and each folder of readable copies take now. */
export async function readStorage(platform: Platform): Promise<Storage> {
  const data = await lucentFolder(platform)
  const cache = joinPath(data, 'cache')
  const backups = joinPath(data, 'Backups')
  // Each folder on its own: one that can't be listed leaves the other's size showing.
  const read = async (list: () => Promise<Listed[]>) => list().then((files) => ({ files, unreadable: false }), () => ({ files: [] as Listed[], unreadable: true }))
  const [{ files: cached, unreadable: cacheUnreadable }, { files: copies, unreadable: backupsUnreadable }] = await Promise.all([read(() => cacheFiles(platform, cache)), read(() => backupFiles(platform, backups))])
  const byFolder = new Map<string, Listed[]>()
  for (const file of copies) {
    const key = fileKey(topFolder(file.relative))
    byFolder.set(key, [...byFolder.get(key) ?? [], file])
  }
  const kinds = await backupKinds(platform, [...byFolder.values()].map((files) => topFolder(files[0].relative)))
  const groups = [...byFolder.entries()].map(([key, files]) => ({ folder: topFolder(files[0].relative), kind: kinds.get(key)!, ...total(files) }))
    .sort((a, b) => a.folder.localeCompare(b.folder))
  return { cache: { path: cache, ...total(cached), ...(cacheUnreadable ? { unreadable: true } : {}) }, backups: { path: backups, groups, ...(backupsUnreadable ? { unreadable: true } : {}) } }
}

/** Removes the folders left empty by the files just removed, and the `extra` ones if empty too, deepest first. */
async function removeEmptyFolders(platform: Platform, root: string, files: Listed[], extra: string[] = []) {
  const folders = new Set(files.flatMap((file) => {
    const parts = file.relative.split('\\')
    return parts.slice(0, -1).map((_, i) => joinPath(root, ...parts.slice(0, i + 1)))
  }))
  for (const folder of extra) folders.add(folder)
  await platform.removeDirectoriesIfEmpty([...folders].sort((a, b) => b.split('\\').length - a.split('\\').length))
}

/** Removes every cached file. Each is downloaded again the next time an install, update, version change or repair needs it. */
export async function clearCache(platform: Platform): Promise<Cleared> {
  const cache = joinPath(await lucentFolder(platform), 'cache')
  const files = await cacheFiles(platform, cache)
  await platform.removeMany(files.map((file) => file.path))
  return total(files)
}

/**
 * Removes the named folders of readable copies and what they hold. A name that isn't one of the folders is ignored.
 * `shown` is the list the player ticked from: a folder that list called redundant (an install or Reset copy) and that has since become
 * the only copy of something (another window started a vanilla Uninstall, the game folder went away) is left, and reported in `skipped`.
 */
export async function clearBackups(platform: Platform, folders: string[], shown: BackupGroup[] = []): Promise<Cleared> {
  const backups = joinPath(await lucentFolder(platform), 'Backups')
  const asShown = new Map(shown.map((group) => [fileKey(group.folder), startsTicked(group.kind)]))
  const fresh = (await readStorage(platform)).backups
  // Without a fresh reading there is nothing to check the list against, so nothing is removed.
  if (fresh.unreadable) throw new Error('Lucent can’t read the Backups folder right now, so it can’t tell which copies are safe to clear. Try again.')
  const now = new Map(fresh.groups.map((group) => [fileKey(group.folder), startsTicked(group.kind)]))
  const skipped = folders.filter((folder) => asShown.get(fileKey(folder)) === true && now.get(fileKey(folder)) === false)
  const wanted = new Set(folders.filter((folder) => !skipped.includes(folder)).map(fileKey))
  const files = (await backupFiles(platform, backups)).filter((file) => wanted.has(fileKey(topFolder(file.relative))))
  await platform.removeMany(files.map((file) => file.path))
  // Listed from `Backups` last, so it goes too once nothing is left in it, as a put-back Uninstall leaves it.
  const named = [...new Set(files.map((file) => joinPath(backups, topFolder(file.relative))))]
  await removeEmptyFolders(platform, backups, files, [...named, backups])
  return { ...total(files), ...(skipped.length ? { skipped } : {}) }
}
