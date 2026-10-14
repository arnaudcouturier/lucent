// XIVLauncher auto-repair: the headless runs XIVLauncher's add-on entries start, with no window.
// The check runs when the game launches; the repair runs once it closes and its files are no longer locked.
import type { HeadlessMode, Platform } from './platform'
import { checkHealth } from './health'
import { failureReason, migrateDeployment, readDeployment, repairDeployment } from './deployment'
import { checkPickedFolder } from './gameFolder'
import { loadManifest } from './manifest'
import { joinPath } from './paths'
import { requireGameStopped } from './gameAccess'
import { xivLauncherGamePath } from './xivLauncher'
import { withOperationLock } from './operation'
import { fileCount } from './format'
import { openActivityLog, type LogLevel } from './log'
import { readResolvedScreen } from './screen'

export type HeadlessOutcome =
  | { kind: 'no-deployment' | 'healthy' | 'repaired' }
  | { kind: 'drift'; files: string[] }
  | { kind: 'failed'; reason: string }

/** Runs a headless check or repair of the game folder XIVLauncher launches, then notifies the outcome. Never throws. */
export async function runHeadless(platform: Platform, mode: HeadlessMode): Promise<HeadlessOutcome> {
  let outcome: HeadlessOutcome
  try { outcome = await withOperationLock(platform, () => mode === 'check' ? check(platform) : repair(platform)) }
  catch (error) { outcome = { kind: 'failed', reason: failureReason(error) } }
  // The window's Logs section is the only place a run with no window can be read afterwards.
  const line = logLineFor(mode, outcome)
  if (line) {
    const log = openActivityLog(platform)
    log.write(line.level, `${mode === 'check' ? 'XIVLauncher started XIV' : 'XIV closed'}: ${line.text}`)
    await log.flushed()
  }
  const notification = notificationFor(mode, outcome)
  if (notification) {
    try { await platform.notify(notification.title, notification.body) }
    catch { /* Nobody is left to tell; the window shows the same state on next open. */ }
  }
  return outcome
}

function logLineFor(mode: HeadlessMode, outcome: HeadlessOutcome): { level: LogLevel; text: string } | null {
  switch (outcome.kind) {
    case 'healthy': return { level: 'info', text: mode === 'check' ? 'health check healthy' : 'nothing to repair' }
    case 'drift': return { level: 'warning', text: `drift in ${fileCount(outcome.files.length)}, to repair when XIV closes` }
    case 'repaired': return { level: 'success', text: 'repair finished' }
    case 'failed': return { level: 'error', text: `Lucent couldn’t ${mode}. ${outcome.reason}` }
    default: return null
  }
}

function notificationFor(mode: HeadlessMode, outcome: HeadlessOutcome): { title: string; body: string } | null {
  switch (outcome.kind) {
    case 'drift': return { title: 'Your game files changed', body: 'Lucent will repair when you close the game.' }
    case 'repaired': return { title: 'Lucent repaired your game', body: 'Everything is back in place for your next launch.' }
    case 'failed': return mode === 'check'
      ? { title: 'Lucent couldn’t check your game', body: `${outcome.reason} Open Lucent to check again.` }
      : { title: 'Lucent couldn’t repair your game', body: `${outcome.reason} Open Lucent to repair.` }
    default: return null
  }
}

/** The deployment in the game folder XIVLauncher launches; an unfinished one is left to the window's recovery. */
async function launchedDeployment(platform: Platform) {
  const path = await xivLauncherGamePath(platform)
  const folder = path ? await checkPickedFolder(platform, path) : null
  let record = folder ? await readDeployment(platform, folder.path) : null
  if (record?.status === 'applying') throw new Error('An earlier change didn’t finish.')
  // A 0.1.1 record drops the config text it kept, once; the files stay as they are.
  const migrated = folder && record?.status === 'complete' ? await migrateDeployment(platform, folder.path) : null
  if (migrated) {
    record = migrated
    const log = openActivityLog(platform)
    log.write('info', 'Migrated the deployment record: Lucent no longer tracks the config files, which stay as they are.')
    await log.flushed()
  }
  return folder && record?.status === 'complete' ? { folder, record } : null
}

async function check(platform: Platform): Promise<HeadlessOutcome> {
  const launched = await launchedDeployment(platform)
  if (!launched) return { kind: 'no-deployment' }
  const drift = await checkHealth(platform, launched.record, launched.folder.version)
  return drift ? { kind: 'drift', files: drift.files } : { kind: 'healthy' }
}

/** Repairs only the deployed content version: a headless run never updates and never asks for administrator access. */
async function repair(platform: Platform): Promise<HeadlessOutcome> {
  const launched = await launchedDeployment(platform)
  if (!launched) return { kind: 'no-deployment' }
  const { folder, record } = launched
  const drift = await checkHealth(platform, record, folder.version, true)
  if (!drift) return { kind: 'healthy' }
  await requireGameStopped(platform)
  if (!await platform.isDirectoryWritable(joinPath(folder.path, 'game'), drift.files)) {
    return { kind: 'failed', reason: 'Windows needs administrator access to change the game folder.' }
  }
  const manifest = await loadManifest(platform)
  const content = manifest.status === 'ready' ? manifest.manifest.versions.find((v) => v.id === record.contentVersion) ?? null : null
  // A missing config is written with the frame cap of XIV's screen as it is now; a screen that can't be read leaves the content's values.
  const screen = await readResolvedScreen(platform).catch(() => null)
  const repaired = await repairDeployment(platform, folder.path, drift.files, content, manifest.status === 'ready' ? manifest.source : null, () => {}, screen)
  // The full check after the repair also saves the patched game version as healthy.
  const remaining = await checkHealth(platform, repaired, folder.version, true)
  return remaining ? { kind: 'failed', reason: 'Some files still differ after the repair.' } : { kind: 'repaired' }
}
