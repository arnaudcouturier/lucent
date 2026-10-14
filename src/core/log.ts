// The activity log: Lucent's own account of what it did, a line at a time, in `lucent.log` in its data folder.
// It is a file so that every Lucent process adds to the same account: the window, a relaunch with administrator
// access and XIVLauncher's headless runs. The Logs section tails it, next to the logs the deployed tools write in the
// game folder. It is not the journal: nothing is ever undone from it.
import { PlatformError, type Platform } from './platform'
import { joinPath, normalizePath } from './paths'
import { fileCount, sizeLabel } from './format'
import type { DeploymentPhase, DeploymentProgress, DeploymentRecord } from './deployment'
import type { State } from './core'

/** `detail` is a single file written or removed; the others are what the player would want to read first. */
export type LogLevel = 'detail' | 'info' | 'success' | 'warning' | 'error'

export interface LogLine {
  /** `2026-10-13` and `19:14:05`, in the player's time zone; null for a tool's line, shown as the tool wrote it. */
  date: string | null
  time: string | null
  level: LogLevel
  text: string
}

export interface ActivityLog {
  write(level: LogLevel, text: string): void
  /** Resolves once every line written so far is in the file. */
  flushed(): Promise<void>
}

/** A log the Logs section can show. `file` is `lucent.log`, or a tool's log relative to the game's `game` folder. */
export interface LogSource {
  id: string
  label: string
  file: string
}

export const LUCENT_LOG: LogSource = { id: 'lucent', label: 'Lucent', file: 'lucent.log' }

/** How many lines the Logs section shows and copies. */
const TAIL_LINES = 500
/** Past this size the log is cut back to its last lines the next time Lucent opens. */
const MAX_BYTES = 512 * 1024
const KEPT_LINES = 2000

const activityLogPath = async (platform: Platform) => joinPath(await platform.envFolder('LocalAppData'), 'Lucent', LUCENT_LOG.file)

const pad = (value: number) => String(value).padStart(2, '0')
const stamp = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
const LINE = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) \[(detail|info|success|warning|error)\] (.*)$/

/**
 * Lines written while an append is under way go out together in the next one, in order. A line that can't be
 * written is dropped: the log is never worth failing the work it describes.
 */
export function openActivityLog(platform: Platform, now: () => Date = () => new Date()): ActivityLog {
  let pending = ''
  let writing = Promise.resolve()
  const flush = async () => {
    const text = pending
    pending = ''
    try { await platform.appendText(await activityLogPath(platform), text) } catch { /* Dropped. */ }
  }
  return {
    write(level, text) {
      const idle = !pending
      pending += `${stamp(now())} [${level}] ${text.replace(/\s*[\r\n]+\s*/g, ' ')}\n`
      if (idle) writing = writing.then(flush)
    },
    flushed: () => writing,
  }
}

/** Keeps the log from growing without end. A missing log has nothing to trim; any other failure leaves it as it is. */
export async function trimActivityLog(platform: Platform): Promise<void> {
  try {
    const path = await activityLogPath(platform)
    if ((await platform.stat(path)).size > MAX_BYTES) await platform.writeText(path, `${await platform.readTextTail(path, KEPT_LINES)}\n`)
  } catch { /* As it is. */ }
}

/** `path` relative to the game folder's `game` folder, or null when it lies elsewhere. */
export function gameRelative(gameFolder: string | null, path: string): string | null {
  if (!gameFolder) return null
  const root = `${normalizePath(joinPath(gameFolder, 'game'))}\\`
  const full = normalizePath(path)
  return full.toLowerCase().startsWith(root.toLowerCase()) ? full.slice(root.length) : null
}

type Logged = Pick<Platform, 'copyFile' | 'copyMany' | 'writeText' | 'renameFile' | 'removeFile' | 'removeMany' | 'requestElevation' | 'launchExe' | 'exitAndRemove'>

/**
 * The port's methods that the log follows: every file written, renamed or removed inside the game folder becomes a
 * `detail` line once the port has done it, and the calls that end this process wait for the log to be written first.
 */
export function loggedPort(platform: Platform, log: ActivityLog, inGame: (path: string) => string | null): Logged {
  // A config set key by key is written once per key; the log says it once.
  let last = ''
  const detail = (text: string) => {
    if (text !== last) log.write('detail', text)
    last = text
  }
  const note = (verb: string, path: string) => {
    const relative = inGame(path)
    if (relative) detail(`${verb} ${relative}`)
  }
  return {
    async copyFile(from, to, replace, stagingDirectory) { await platform.copyFile(from, to, replace, stagingDirectory); note('wrote', to) },
    async copyMany(items, stagingDirectory) { await platform.copyMany(items, stagingDirectory); for (const { to } of items) note('wrote', to) },
    async writeText(path, text, stagingDirectory) { await platform.writeText(path, text, stagingDirectory); note('wrote', path) },
    async renameFile(from, to, replace) {
      await platform.renameFile(from, to, replace)
      const [before, after] = [inGame(from), inGame(to)]
      if (before && after) detail(`renamed ${before} to ${after}`)
    },
    async removeFile(path) { await platform.removeFile(path); note('removed', path) },
    async removeMany(paths) { await platform.removeMany(paths); for (const path of paths) note('removed', path) },
    async requestElevation(resumePath) { await log.flushed(); return platform.requestElevation(resumePath) },
    async launchExe(path) { await log.flushed(); return platform.launchExe(path) },
    async exitAndRemove(folders) { await log.flushed(); return platform.exitAndRemove(folders) },
  }
}

const PHASE_LINES: Record<DeploymentPhase, (total: number) => string> = {
  downloading: (bytes) => `Downloading ${sizeLabel(bytes)}`,
  'backing-up': (files) => `Backing up ${fileCount(files)}`,
  applying: (changes) => `Applying ${changes.toLocaleString('en')} ${changes === 1 ? 'change' : 'changes'}`,
  checking: (files) => `Checking ${fileCount(files)}`,
}

/** Notes each stage of a deployment once, when its first report says how much work the stage holds. */
export function loggedProgress(log: ActivityLog, report: (progress: DeploymentProgress) => void) {
  const noted = new Set<DeploymentPhase>()
  return (progress: DeploymentProgress) => {
    if (progress.total && !noted.has(progress.phase)) {
      noted.add(progress.phase)
      log.write('info', PHASE_LINES[progress.phase](progress.total))
    }
    report(progress)
  }
}

/** What Scan found, as the log tells it. */
export function scanLines(state: Pick<State, 'gameFolder' | 'graphics' | 'manifest' | 'xivLauncher' | 'appUpdate' | 'gameRunning'>): { level: LogLevel; text: string }[] {
  const { gameFolder, graphics, manifest, xivLauncher, appUpdate, gameRunning } = state
  const lines: { level: LogLevel; text: string }[] = []
  const info = (text: string) => lines.push({ level: 'info', text })
  const warning = (text: string) => lines.push({ level: 'warning', text })
  if (gameFolder.status === 'found') info(`Game folder: ${gameFolder.path}, game ${gameFolder.version ?? 'version unknown'}`)
  else if (gameFolder.status === 'not-found') warning('Game folder: not found')
  if (graphics.status === 'found') info(`Graphics card: ${graphics.adapter.name}${graphics.tier ? `, ${graphics.tier.label} tier` : ''}`)
  else if (graphics.status === 'not-found') warning('Graphics card: not found')
  else if (graphics.status === 'unavailable') warning(`Graphics card: ${graphics.message}`)
  if (manifest.status === 'ready') info(`Manifest: ${manifest.manifest.versions.length} content ${manifest.manifest.versions.length === 1 ? 'version' : 'versions'}${manifest.source.kind === 'local' ? ', read from this machine' : ''}`)
  else if ('message' in manifest) warning(`Manifest: ${manifest.message}`)
  if (xivLauncher.status === 'found') info(`XIVLauncher: found, auto-repair ${xivLauncher.autoRepair ? 'on' : 'off'}`)
  if (gameRunning) info('XIV is running')
  if (appUpdate) info(`Lucent ${appUpdate.version} is available`)
  return lines
}

/** Lucent's own log, then every log the deployed tools write in the game folder, as the content version lists them. */
export function logSources(deployment: Pick<DeploymentRecord, 'recipe'> | null): LogSource[] {
  const tools = deployment?.recipe.generatedFiles.filter(({ path }) => /\.log$/i.test(path)) ?? []
  return [LUCENT_LOG, ...tools.map(({ path }) => ({ id: path, label: path.split(/[\\/]/).at(-1)!.replace(/\.log$/i, ''), file: path }))]
}

/** The level a tool gave its own line, read from the usual `| ERROR |` or `[warning]` marker; `info` without one. */
function toolLevel(line: string): LogLevel {
  if (/[[|]\s*(error|critical|fatal)\s*[\]|]/i.test(line)) return 'error'
  if (/[[|]\s*warn(ing)?\s*[\]|]/i.test(line)) return 'warning'
  if (/[[|]\s*(debug|trace)\s*[\]|]/i.test(line)) return 'detail'
  return 'info'
}

export function parseLog(source: LogSource, text: string): LogLine[] {
  const lines = text.split('\n').filter((line) => line.trim())
  if (source.id !== LUCENT_LOG.id) return lines.map((line) => ({ date: null, time: null, level: toolLevel(line), text: line }))
  return lines.map((line) => {
    const [, date, time, level, rest] = LINE.exec(line) ?? []
    return date ? { date, time, level: level as LogLevel, text: rest } : { date: null, time: null, level: 'info', text: line }
  })
}

/** The last lines of a log as text, or null when it hasn't been written yet. A tool's log needs the game folder. */
export async function readLogTail(platform: Platform, source: LogSource, gameFolder: string | null): Promise<string | null> {
  try {
    if (source.id === LUCENT_LOG.id) return await platform.readTextTail(await activityLogPath(platform), TAIL_LINES)
    if (!gameFolder) return null
    return await platform.readTextTail(await platform.resolveGamePath(joinPath(gameFolder, 'game'), source.file), TAIL_LINES)
  } catch (error) {
    if (error instanceof PlatformError && error.kind === 'not-found') return null
    throw error
  }
}
