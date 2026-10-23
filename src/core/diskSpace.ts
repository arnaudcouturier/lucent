// Free space before a deployment writes: Review warns when a drive looks too full for the plan. A warning only, since a
// deployment that runs out of space rolls back by itself; it never blocks Install or changes the plan.
import type { Platform } from './platform'
import { fileKey, type Plan } from './planner'
import { joinPath, normalizePath } from './paths'

/** A drive with less free space than the plan needs there, both in bytes. */
export interface SpaceShortfall {
  drive: string
  needed: number
  free: number
}

/** On top of what the plan writes: a tenth more, and room for the record, the journal and the log. */
const MARGIN = 0.1
const SLACK = 64 * 1024 ** 2

/** `C:` for a path on a local drive; null for anything else (a network share), whose space can't be read. */
const driveOf = (path: string) => /^[a-z]:\\/i.test(normalizePath(path)) ? path.slice(0, 2).toUpperCase() : null

/**
 * The drives Review warns about; empty when every one has room, or none could be read.
 * - Lucent's data folder takes the downloads the cache lacks (`plan.downloadSize`), the journal's backup of every file the
 *   plan replaces or removes and, for a first deployment, the readable copy of those same files.
 * - The game folder grows by what the plan writes beyond the files it writes over, plus its largest file: a file is written
 *   whole before the one it replaces goes, so a Reset that rewrites everything in place needs about one file of room.
 * Two folders on one drive add up, then get the margin once and are compared with its free space once.
 */
export async function spaceShortfalls(platform: Platform, plan: Plan, folders: { data: string; game: string }, firstDeployment: boolean): Promise<SpaceShortfall[]> {
  const sizes = new Map(plan.files.map((file) => [file.sha256, file.size]))
  const writes = plan.steps.flatMap((step) => step.kind === 'copy' ? [{ path: fileKey(step.to), size: sizes.get(step.file) ?? 0 }] : [])
  const written = writes.reduce((sum, write) => sum + write.size, 0)
  const largest = writes.reduce((most, write) => Math.max(most, write.size), 0)
  const paths = await platform.resolveGamePaths(joinPath(folders.game, 'game'), plan.filesToBackup)
  const stats = await platform.statMany(paths)
  const onDisk = plan.filesToBackup.map((path, i) => ({ path: fileKey(path), size: stats[i]?.kind === 'file' ? stats[i]!.size : 0 }))
  const replaced = onDisk.reduce((sum, file) => sum + file.size, 0)
  const destinations = new Set(writes.map((write) => write.path))
  const overwritten = onDisk.reduce((sum, file) => sum + (destinations.has(file.path) ? file.size : 0), 0)
  const copies = firstDeployment && plan.filesToBackup.length ? 2 : 1
  const volumes = new Map<string, { drive: string | null; path: string; bytes: number }>()
  for (const [path, bytes] of [[folders.data, plan.downloadSize + replaced * copies], [folders.game, Math.max(0, written - overwritten) + largest]] as const) {
    const drive = driveOf(path)
    const key = drive ?? normalizePath(path).toLowerCase()
    const volume = volumes.get(key)
    if (volume) volume.bytes += bytes
    else volumes.set(key, { drive, path, bytes })
  }
  const short: SpaceShortfall[] = []
  for (const { drive, path, bytes } of volumes.values()) {
    const free = drive ? await platform.freeSpace(path) : null
    const needed = Math.ceil(bytes * (1 + MARGIN)) + SLACK
    if (drive && free !== null && free < needed) short.push({ drive, needed, free })
  }
  return short.sort((a, b) => a.drive.localeCompare(b.drive))
}

const MB = 1024 ** 2
const GB = 1024 ** 3
/** GB from 1 GB up, MB below, to one decimal. Both units are powers of two, so the division is exact before it rounds. */
function label(bytes: number, round: (value: number) => number) {
  const mb = round(bytes * 10 / MB) / 10
  return bytes >= GB || mb >= 1024 ? `${(round(bytes * 10 / GB) / 10).toFixed(1)} GB` : `${mb.toFixed(1)} MB`
}

/** The warning's figures: the need rounded up and the free space down, so a short drive never reads as having enough. */
export const spaceLabels = ({ needed, free }: SpaceShortfall) => ({ needed: label(needed, Math.ceil), free: label(free, Math.floor) })
