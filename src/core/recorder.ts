// Settings' Troubleshooting group: OptiScaler-FFXIV (v0.4.0 on) records frame generation events to `fg-recordings` beside its DLL
// while `[FramePacing] FgRecorder` is `true`, one session per game run. This reads the key and the recordings and clears them;
// `setFgRecorder` (deployment.ts) writes the key.
import type { Platform } from './platform'
import { readConfig } from './configs'
import { readIni } from './ini'
import { joinPath } from './paths'
import { maybeStat } from './deployment'
import { NEEDS_NEWER_CONTENT, patchSwitchProblem } from './gamePatch'
import { guardGameWrites } from './gameAccess'
import { listed, removeEmptyFolders, total, type Cleared, type Listed } from './storage'
import { FG_RECORDER, RECORDINGS_FOLDER } from './planner'

export { FG_RECORDER, RECORDINGS_FOLDER }
/**
 * The names the recorder writes and later deletes itself; group 1 is the session. Its time stamp has a fixed width and comes first,
 * so a plain string comparison of two sessions orders them by time, and by process id when the stamps are the same.
 */
export const RECORDING_FILE = /^(fg-rec-\d{8}-\d{6}-\d{3}-\d+)\.jsonl(?:\.[1-8])?$/

export interface Recordings {
  path: string
  sessions: number
  files: number
  bytes: number
  newest: { name: string; files: number; bytes: number } | null
  unreadable?: boolean
}
export type Recorder = ({ status: 'ready'; on: boolean } | { status: 'unavailable'; reason: string }) & { recordings: Recordings | null }

/** What the recorder has written so far, session by session; null when the folder isn't there. */
export async function readRecordings(platform: Platform, gameFolder: string): Promise<Recordings | null> {
  let path = joinPath(gameFolder, 'game', RECORDINGS_FOLDER)
  // A junction or link where the folder should be is refused; it costs the row its size, not the switch above it.
  try { path = await platform.resolveGamePath(joinPath(gameFolder, 'game'), RECORDINGS_FOLDER) }
  catch { return { path, sessions: 0, files: 0, bytes: 0, newest: null, unreadable: true } }
  const stat = await maybeStat(platform, path)
  if (stat?.kind !== 'dir') return null
  let files: Listed[]
  try { files = await listed(platform, path, (relative) => RECORDING_FILE.test(relative)) }
  catch { return { path, sessions: 0, files: 0, bytes: 0, newest: null, unreadable: true } }
  // A session is one game run: the name it was given, then every rotation that grew from it.
  const sessions = new Map<string, { files: number; bytes: number }>()
  for (const file of files) {
    const name = RECORDING_FILE.exec(file.relative)![1]
    const session = sessions.get(name) ?? { files: 0, bytes: 0 }
    session.files++
    session.bytes += file.bytes
    sessions.set(name, session)
  }
  let newest: Recordings['newest'] = null
  for (const [name, session] of sessions) if (!newest || name > newest.name) newest = { name, ...session }
  const recorded = total(files)
  return { path, sessions: sessions.size, files: recorded.files, bytes: recorded.bytes, newest }
}

/** The switch as OptiScaler.ini says now, with the recordings the fork has written beside it. */
export async function readRecorder(platform: Platform, gameFolder: string): Promise<Recorder> {
  const read = await readConfig(platform, await platform.resolveGamePath(joinPath(gameFolder, 'game'), FG_RECORDER.file))
  const recordings = await readRecordings(platform, gameFolder)
  if (read.kind !== 'readable') return { status: 'unavailable', reason: patchSwitchProblem(read), recordings }
  const value = readIni(read.text).get(FG_RECORDER.section, FG_RECORDER.key)
  return value === undefined ? { status: 'unavailable', reason: NEEDS_NEWER_CONTENT, recordings } : { status: 'ready', on: value.trim().toLowerCase() === 'true', recordings }
}

/** Removes the names the recorder writes itself, then the folder once nothing else is left in it. XIV must be closed. */
export async function clearRecordings(platform: Platform, gameFolder: string): Promise<Cleared> {
  platform = await guardGameWrites(platform, gameFolder)
  const path = await platform.resolveGamePath(joinPath(gameFolder, 'game'), RECORDINGS_FOLDER)
  if ((await maybeStat(platform, path))?.kind !== 'dir') return { files: 0, bytes: 0 }
  const files = await listed(platform, path, (relative) => RECORDING_FILE.test(relative))
  await platform.removeMany(files.map((file) => file.path))
  await removeEmptyFolders(platform, path, files, [path])
  return total(files)
}
