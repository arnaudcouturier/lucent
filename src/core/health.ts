// The health check: compares the game folder against what the deployment record says it should be.
import type { FileStat, Platform } from './platform'
import { dataPaths, maybeStat, type DeploymentRecord } from './deployment'
import { fileKey } from './planner'
import { joinPath } from './paths'

export interface Drift {
  /** Game-folder paths, relative to `game\`, that are missing or no longer what Lucent deployed. */
  files: string[]
  /** The new game version when it changed since the last healthy check. */
  patch: string | null
}

/**
 * User changes are never drift: an owned config only has to be present and parseable, and a shipped preset only present.
 * Every other file must keep its hash. A matching size and modified time stand in for the hash, unless `full` is set
 * or the game version changed since the last healthy check. A healthy check saves the game version and refreshed stamps.
 */
export async function checkHealth(platform: Platform, record: DeploymentRecord, gameVersion: string | null, full = false): Promise<Drift | null> {
  const patched = record.gameVersion !== gameVersion
  full ||= patched
  const root = joinPath(record.gameFolder, 'game')
  const configs = new Set(Object.keys(record.ownedConfigs).map(fileKey))
  const presets = new Set(record.recipe.shippedPresets.map((p) => fileKey(p.path)))
  const files: string[] = []
  let restamped = false
  for (const [relative, expected] of Object.entries(record.files)) {
    let path: string
    let stat: FileStat | null
    try {
      path = await platform.resolveGamePath(root, relative)
      stat = await maybeStat(platform, path)
    } catch { files.push(relative); continue }
    if (stat?.kind !== 'file') { files.push(relative); continue }
    if (presets.has(fileKey(relative))) continue
    if (configs.has(fileKey(relative))) {
      if (!await parseable(platform, path)) files.push(relative)
      continue
    }
    if (!full && stat.size === expected.size && stat.modifiedMs === expected.modifiedMs) continue
    if (await platform.hashFile(path) !== expected.sha256) { files.push(relative); continue }
    if (stat.size !== expected.size || stat.modifiedMs !== expected.modifiedMs) {
      record.files[relative] = { ...stat, sha256: expected.sha256 }
      restamped = true
    }
  }
  if (files.length) return { files, patch: patched && gameVersion && record.gameVersion !== undefined ? gameVersion : null }
  if (patched || restamped) {
    record.gameVersion = gameVersion
    await platform.writeText((await dataPaths(platform, record.gameFolder)).record, JSON.stringify(record, null, 2))
  }
  return null
}

/** The ini module accepts any text, so a config is unparseable only when it can't be read as text. */
async function parseable(platform: Platform, path: string): Promise<boolean> {
  try { return !(await platform.readText(path)).includes('\0') } catch { return false }
}
