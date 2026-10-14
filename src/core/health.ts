// The health check: compares the game folder against what the deployment record says it should be.
import type { FileStat, Platform } from './platform'
import { dataPaths, maybeStat, type DeploymentRecord } from './deployment'
import { fileKey } from './planner'
import { joinPath } from './paths'
import { readableText } from './configs'

export interface Drift {
  /** Game-folder paths, relative to `game\`, that are missing or no longer what Lucent deployed. */
  files: string[]
  /** The new game version when it changed since the last healthy check. */
  patch: string | null
}

/**
 * The player's changes are never drift: a config file only has to be present and readable, and a shipped preset only present.
 * Every other file must keep its hash. A matching size and modified time stand in for the hash, unless `full` is set
 * or the game version changed since the last healthy check. A healthy check saves the game version and refreshed stamps.
 */
export async function checkHealth(platform: Platform, record: DeploymentRecord, gameVersion: string | null, full = false, progress?: (checked: number, total: number) => void, options: { persist?: boolean } = {}): Promise<Drift | null> {
  const patched = record.gameVersion !== gameVersion
  full ||= patched
  const root = joinPath(record.gameFolder, 'game')
  const configs = new Set(record.recipe.ownedConfigs.map((c) => fileKey(c.path)))
  const presets = new Set(record.recipe.shippedPresets.map((p) => fileKey(p.path)))
  const files: string[] = []
  let restamped = false
  const entries = Object.entries(record.files)
  progress?.(0, entries.length)
  const located = await locate(platform, root, entries.map(([relative]) => relative))
  const toHash: { relative: string; path: string; stat: FileStat }[] = []
  for (const [index, [relative, expected]] of entries.entries()) {
    const { path, stat } = located[index]
    if (path === null || stat?.kind !== 'file') { files.push(relative); continue }
    if (presets.has(fileKey(relative))) continue
    if (configs.has(fileKey(relative))) {
      if (await readableText(platform, path) === null) files.push(relative)
      continue
    }
    if (!full && stat.size === expected.size && stat.modifiedMs === expected.modifiedMs) continue
    toHash.push({ relative, path, stat })
  }
  // Hashing is the only slow part, done in batches so a Scan can show its progress.
  const checked = entries.length - toHash.length
  for (let i = 0; i < toHash.length; i += HASH_BATCH) {
    progress?.(checked + i, entries.length)
    const batch = toHash.slice(i, i + HASH_BATCH)
    const hashes = await platform.hashMany(batch.map((file) => file.path))
    batch.forEach(({ relative, stat }, k) => {
      const expected = record.files[relative]
      if (hashes[k] !== expected.sha256) { files.push(relative); return }
      if (stat.size !== expected.size || stat.modifiedMs !== expected.modifiedMs) {
        record.files[relative] = { ...stat, sha256: expected.sha256 }
        restamped = true
      }
    })
  }
  progress?.(entries.length, entries.length)
  if (files.length) return { files, patch: patched && gameVersion && record.gameVersion !== undefined ? gameVersion : null }
  if ((patched || restamped) && options.persist !== false) {
    record.gameVersion = gameVersion
    await platform.writeText((await dataPaths(platform, record.gameFolder)).record, JSON.stringify(record, null, 2))
  }
  return null
}

const HASH_BATCH = 128

/**
 * Each deployed path and what's there now, in one round trip for the lot. A path that can't be resolved or read
 * (a junction, access denied) counts as missing; only then are the files looked at one by one, to say which.
 */
async function locate(platform: Platform, root: string, relatives: string[]): Promise<{ path: string | null; stat: FileStat | null }[]> {
  try {
    const paths = await platform.resolveGamePaths(root, relatives)
    const stats = await platform.statMany(paths)
    return paths.map((path, i) => ({ path, stat: stats[i] }))
  } catch {
    const located: { path: string | null; stat: FileStat | null }[] = []
    for (const relative of relatives) {
      try {
        const path = await platform.resolveGamePath(root, relative)
        located.push({ path, stat: await maybeStat(platform, path) })
      } catch { located.push({ path: null, stat: null }) }
    }
    return located
  }
}
