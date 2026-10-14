import { assertGamePath, FRAME_GENERATION_IDS, validateManifest, type ContentFile, type ContentVersion, type ExistingSetupSignature, type FrameGenerationId, type HdrMode, type IniSetting, type ProfileId, type Tier } from '../shared/manifest'
import { type ContentSource } from './manifest'
import { PlatformError, type FileStat, type GpuAdapter, type Platform } from './platform'
import { disabledName, fileKey, planDeployment, stepWritePaths, type DeploymentScan, type Plan, type PlanSelection, type PlanStep } from './planner'
import { detectExistingSetups } from './existingSetup'
import { joinPath, normalizePath, parentPath } from './paths'
import { mergeIni, readIni } from './ini'
import { cacheSnapshot, type CachedVersion } from './versions'
import { guardGameWrites, requireGameStopped } from './gameAccess'
import { isGameFolder } from './gameFolder'
import type { ResolvedScreen } from './screen'
import { defaultFrameGenerationMode, frameGenerationOptionsForGpu, matchFrameGenerationMode } from './frameGeneration'
import { selectProfileForUpdate } from './profileValues'
import { autoHdrDisableWasApplied, isAutoHdrOnlyChange, latestAutoHdrDisableIndex, matchHdrMode, restoreAutoHdr } from './hdr'

export interface FileStamp extends FileStat { sha256: string }
export interface JournalEntry {
  step?: PlanStep
  /** A durable, reversible side effect outside the game folder, such as a per-exe registry value. */
  registry?: { kind: 'user-gpu-preferences'; userSid: string; name: string; before: string | null; after: string | null }
  before: Record<string, string | null>
  after: Record<string, string | null>
  /** Saved after an intent has been undone, before proceeding to any earlier intent. */
  undone?: boolean
}
export interface DeploymentRecord {
  schemaVersion: 1
  status: 'applying' | 'complete' | 'rolled-back'
  gameFolder: string
  tier: string
  graphics: GpuAdapter
  contentVersion: string
  /** Current content and the two most recently applied other versions. */
  cachedVersions?: CachedVersion[]
  pinned?: boolean
  /** Completed with the deployment; settings are reconciled idempotently after a crash. */
  pendingSelection?: { skip: string | null }
  includeReShade: boolean
  enabled: boolean
  profile?: ProfileId | null
  frameGenerationMode?: FrameGenerationId | null
  /** An interrupted change to a complete deployment (a profile change or a repair) undoes only the journal entries from this index onward. */
  changeStart?: number
  /** During a change, the directories it created start at this index of `createdDirectories`; undoing the change removes them. */
  changeDirectoryStart?: number
  /** An uninstall in progress: recovery finishes it rather than protecting what the mods changed in Lucent's own files. */
  uninstalling?: boolean
  recipe: Plan['recipe']
  journal: JournalEntry[]
  /** Directories absent before the deployment, recorded before any step can create them. */
  createdDirectories?: string[]
  /** The tier's generated files that were absent before the deployment; uninstall removes only these. */
  generatedFiles?: string[]
  /** Preallocated undo checkpoints: one byte per step, then one once the whole deployment is undone. */
  undoCheckpoints?: { id: string; size: number }
  ownedConfigs: Record<string, string>
  files: Record<string, FileStamp>
  /** The game version at the last healthy check; a different one means a patch, so the next check hashes every file. */
  gameVersion?: string | null
  /**
   * The folder in `Lucent\Backups` holding a readable copy of every file from before the deployment, under its own path.
   * The journal restores from its own backups; this copy is for the player, and goes once the deployment is undone.
   */
  backupFolder?: string
}
export type DeploymentPhase = 'downloading' | 'backing-up' | 'applying' | 'checking'
/** `done` of `total` counts bytes while downloading, and files in every other phase. */
export interface DeploymentProgress { phase: DeploymentPhase; progress: number; file: string | null; done?: number; total?: number }

export function failureReason(error: unknown): string {
  if (error instanceof PlatformError) {
    switch (error.kind) {
      case 'network': return 'Lucent couldn’t download a content file. Check your connection and try again.'
      case 'not-found': return 'A required file is missing. Try again; if it still fails, report this content version.'
      case 'hash-mismatch': return 'A file failed its hash check. Try again to download a fresh copy.'
      case 'disk-full': return 'There isn’t enough free disk space. Free some space and try again.'
      case 'locked': return 'A file is in use. Close XIV and any apps using the game folder, then try again.'
      case 'access-denied': return 'Windows denied access to a required file. Check folder permissions and try again.'
      case 'cancelled': return error.message
    }
  }
  return error instanceof Error ? error.message : String(error)
}

export class DeploymentError extends Error {
  readonly needsScan: boolean
  constructor(error: unknown, readonly recoveryRequired: boolean, recoveryError?: unknown) {
    const reason = failureReason(error)
    // XIV starting mid-install blocks both the step and its undo; say so once.
    const recovery = failureReason(recoveryError) === reason ? '' : ` ${failureReason(recoveryError)}`
    super(`${reason} ${recoveryRequired
      ? `Recovery could not finish.${recovery} Keep Lucent’s journal and backups; try recovery again once the problem is resolved.`
      : 'Lucent restored the game folder to how it was before.'}`)
    this.name = 'DeploymentError'
    this.needsScan = error instanceof UnreviewedFilesError
  }
}

/** First-deployment takeovers must have appeared in Scan; a live rescan cannot authorize more. */
export class UnreviewedFilesError extends Error {
  constructor(paths: string[]) {
    super(`${paths.length ? `Protecting a user file: ${paths.join(', ')}. ` : ''}The game folder changed since Scan. Run Scan again to review its files before installing.`)
    this.name = 'UnreviewedFilesError'
  }
}

export function assertReviewedTakeovers(plan: Plan, reviewedPaths: readonly string[]) {
  const reviewed = new Set(reviewedPaths.map(fileKey))
  const unexpected = plan.filesToBackup.filter((path) => !reviewed.has(fileKey(path)))
  if (unexpected.length) throw new UnreviewedFilesError(unexpected)
}

async function hashText(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The journal's backups are named by hash; the player's readable copies live apart, in `Backups`. */
export async function dataPaths(platform: Platform, gameFolder: string) {
  const data = joinPath(await platform.envFolder('LocalAppData'), 'Lucent')
  const id = await hashText(normalizePath(gameFolder).toLowerCase())
  const deployment = joinPath(data, 'deployments', id)
  return { data, cache: joinPath(data, 'cache'), backups: joinPath(deployment, 'backups'), readableBackups: joinPath(data, 'Backups'), record: joinPath(deployment, 'record.json') }
}

const BACKUP_FOLDER_NAME = /^(?!\.+$)[^\\/:*?"<>|\u0000-\u001f]+$/

/**
 * Where a first deployment keeps the player's original files: `Backups\<game folder name>`, numbered when another
 * game folder's deployment already uses that name. The `game` folder inside mirrors the game's.
 */
export async function backupFolderName(platform: Platform, gameFolder: string): Promise<string> {
  const base = normalizePath(gameFolder).split('\\').at(-1)?.replace(/[:*?"<>|]/g, '').trim() || 'Game'
  const taken = new Set<string>()
  try {
    for await (const record of deploymentRecords(platform)) {
      if (record.backupFolder && record.status !== 'rolled-back' && fileKey(normalizePath(record.gameFolder)) !== fileKey(normalizePath(gameFolder))) taken.add(record.backupFolder.toLowerCase())
    }
  } catch { /* A damaged record is recovery's concern; the name only needs to be readable. */ }
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`
  return name
}

/** The readable backup's mirror of the game's `game` folder. */
export async function readableBackupPath(platform: Platform, gameFolder: string, name: string): Promise<string> {
  return joinPath((await dataPaths(platform, gameFolder)).readableBackups, name, 'game')
}

/** Best effort: the journal never depends on the readable copy. */
async function removeReadableBackup(platform: Platform, record: DeploymentRecord) {
  if (!record.backupFolder) return
  try {
    const { readableBackups } = await dataPaths(platform, record.gameFolder)
    const folder = joinPath(readableBackups, record.backupFolder)
    if (!await maybeStat(platform, folder)) return
    const files = await platform.listFiles(folder)
    await platform.removeMany(files.map((relative) => joinPath(folder, relative)))
    const directories = new Set(files.flatMap((relative) => {
      const parts = joinPath(relative).split('\\')
      return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('\\'))
    }))
    await platform.removeDirectoriesIfEmpty([...[...directories].sort((a, b) => b.split('\\').length - a.split('\\').length)
      .map((relative) => joinPath(folder, relative)), folder, readableBackups])
  } catch { /* Leftover copies are harmless, and the next deployment of this folder replaces them. */ }
}

export async function maybeStat(platform: Platform, path: string): Promise<FileStat | null> {
  try { return await platform.stat(path) } catch (error) {
    if (error instanceof PlatformError && error.kind === 'not-found') return null
    throw error
  }
}

export async function readDeployment(platform: Platform, gameFolder: string): Promise<DeploymentRecord | null> {
  const { record } = await dataPaths(platform, gameFolder)
  if (!await maybeStat(platform, record)) return null
  const value = JSON.parse(await platform.readText(record)) as DeploymentRecord
  // A damaged record must never authorize writes outside this folder or arbitrary backup paths.
  if (!value || value.schemaVersion !== 1 || !['applying', 'complete', 'rolled-back'].includes(value.status)
    || typeof value.gameFolder !== 'string' || fileKey(normalizePath(value.gameFolder)) !== fileKey(normalizePath(gameFolder))
    || !Array.isArray(value.journal) || !value.files || !value.ownedConfigs || !value.recipe) throw new Error('The deployment record is damaged. Keep it and its backups for recovery.')
  for (const entry of value.journal) {
    if (!entry || !entry.before || !entry.after || (entry.undone !== undefined && typeof entry.undone !== 'boolean')
      || (!!entry.step === !!entry.registry)) throw new Error('The deployment journal is damaged.')
    if (entry.registry && (entry.registry.kind !== 'user-gpu-preferences'
      || typeof entry.registry.userSid !== 'string' || !/^S-1-(?:\d+-){1,14}\d+$/.test(entry.registry.userSid)
      || typeof entry.registry.name !== 'string' || fileKey(normalizePath(entry.registry.name)) !== fileKey(normalizePath(joinPath(value.gameFolder, 'game', 'ffxiv_dx11.exe')))
      || /[\r\n\0]/.test(entry.registry.name)
      || (entry.registry.before !== null && typeof entry.registry.before !== 'string')
      || (entry.registry.after !== null && typeof entry.registry.after !== 'string')
      || !isAutoHdrOnlyChange(entry.registry.before, entry.registry.after)
      || Object.keys(entry.before).length !== 0 || Object.keys(entry.after).length !== 0)) throw new Error('The deployment registry journal is damaged.')
    for (const [path, hash] of [...Object.entries(entry.before), ...Object.entries(entry.after)]) {
      assertGamePath(path)
      if (hash !== null && !/^[a-f0-9]{64}$/.test(hash)) throw new Error('The deployment backup hash is invalid.')
    }
  }
  if (value.frameGenerationMode !== undefined && value.frameGenerationMode !== null
    && !FRAME_GENERATION_IDS.includes(value.frameGenerationMode)) throw new Error('The frame-generation selection is damaged.')
  for (const path of [...Object.keys(value.files), ...Object.keys(value.ownedConfigs)]) assertGamePath(path)
  if (value.gameVersion !== undefined && value.gameVersion !== null && typeof value.gameVersion !== 'string') throw new Error('The deployment record is damaged. Keep it and its backups for recovery.')
  if (value.createdDirectories !== undefined) {
    if (!Array.isArray(value.createdDirectories)) throw new Error('The deployment directory journal is damaged.')
    for (const path of value.createdDirectories) assertGamePath(path)
  }
  if (value.generatedFiles !== undefined) {
    if (!Array.isArray(value.generatedFiles)) throw new Error('The deployment record is damaged. Keep it and its backups for recovery.')
    for (const path of value.generatedFiles) assertGamePath(path)
  }
  if (value.uninstalling !== undefined && typeof value.uninstalling !== 'boolean') throw new Error('The uninstall journal is damaged.')
  if (value.backupFolder !== undefined && (typeof value.backupFolder !== 'string' || !BACKUP_FOLDER_NAME.test(value.backupFolder))) throw new Error('The deployment record is damaged. Keep it and its backups for recovery.')
  if (value.pinned !== undefined && typeof value.pinned !== 'boolean') throw new Error('The content pin is damaged.')
  if (value.pendingSelection !== undefined && (!value.pendingSelection || (value.pendingSelection.skip !== null && !/^\d{4}\.\d{2}\.\d{2}$/.test(value.pendingSelection.skip)))) throw new Error('The content selection is damaged.')
  if (value.cachedVersions !== undefined) {
    if (!Array.isArray(value.cachedVersions) || value.cachedVersions.length > 3) throw new Error('The content cache record is damaged.')
    for (const cached of value.cachedVersions) {
      if (!cached?.tier || cached.tier.id !== value.tier) throw new Error('The cached tier is damaged.')
      validateManifest({ schemaVersion: 2, tiers: [{ ...cached.tier, gpuMatch: 'any' }], versions: [cached.content] })
    }
  }
  if (value.changeStart !== undefined && (!Number.isSafeInteger(value.changeStart) || value.changeStart < 0 || value.changeStart > value.journal.length)) throw new Error('The change journal is damaged.')
  if (value.changeDirectoryStart !== undefined && (value.changeStart === undefined || !Number.isSafeInteger(value.changeDirectoryStart)
    || value.changeDirectoryStart < 0 || value.changeDirectoryStart > (value.createdDirectories?.length ?? 0))) throw new Error('The change journal is damaged.')
  if (value.undoCheckpoints && value.changeStart === undefined) {
    const progress = value.undoCheckpoints
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(progress.id) || !Number.isSafeInteger(progress.size) || progress.size <= value.journal.length) throw new Error('The undo checkpoints are damaged.')
    const checkpoints = await platform.readText(checkpointsPath(record, progress.id))
    if (checkpoints.length !== progress.size || !/^[01]+$/.test(checkpoints)) throw new Error('The undo checkpoints are damaged.')
    value.journal.forEach((entry, i) => { if (checkpoints[i] === '1') entry.undone = true })
    if (checkpoints.at(-1) === '1') {
      if (value.journal.some((entry) => !entry.undone)) throw new Error('The undo checkpoints are damaged.')
      value.status = 'rolled-back'
    }
  }
  return value
}

const checkpointsPath = (recordPath: string, id: string) => joinPath(parentPath(recordPath), `undo-${id}.txt`)
const UNDONE = '1'.charCodeAt(0)
/** Checkpoints matter only while a record refers to them, so a leftover is harmless litter in Lucent's data folder. */
const discardCheckpoints = (platform: Platform, recordPath: string, checkpoints: DeploymentRecord['undoCheckpoints']) =>
  checkpoints && platform.removeFile(checkpointsPath(recordPath, checkpoints.id)).catch(() => {})

/** Recovery precedes Scan and does not depend on which folder a launcher currently points at. */
export async function recoverDeployments(platform: Platform, beforeRecovery?: (record: DeploymentRecord) => Promise<void>): Promise<DeploymentRecord[]> {
  const recovered: DeploymentRecord[] = []
  for await (const record of deploymentRecords(platform)) {
    if (record.status !== 'applying') continue
    // A game folder that no longer holds the game has nothing to restore into; leave its record for Scan to report.
    if (!await isGameFolder(platform, record.gameFolder)) continue
    await beforeRecovery?.(record)
    await undoDeployment(platform, record)
    recovered.push(record)
  }
  return recovered
}

/** Every deployment record in Lucent's data folder, whichever game folder it belongs to. */
export async function* deploymentRecords(platform: Platform): AsyncGenerator<DeploymentRecord> {
  const directory = joinPath(await platform.envFolder('LocalAppData'), 'Lucent', 'deployments')
  if (!await maybeStat(platform, directory)) return
  for (const relative of (await platform.listFiles(directory)).sort()) {
    if (!relative.endsWith('record.json')) continue
    const path = joinPath(directory, relative)
    const value = JSON.parse(await platform.readText(path)) as Partial<DeploymentRecord> | null
    if (!value || typeof value.gameFolder !== 'string'
      || fileKey(path) !== fileKey((await dataPaths(platform, value.gameFolder)).record)) {
      throw new Error('The deployment record is damaged. Keep it and its backups for recovery.')
    }
    const record = await readDeployment(platform, value.gameFolder)
    if (record) yield record
  }
}

/** The most recently saved complete deployment whose game folder no longer holds the game. A damaged record is left to recovery. */
export async function lostDeployment(platform: Platform): Promise<DeploymentRecord | null> {
  const directory = joinPath(await platform.envFolder('LocalAppData'), 'Lucent', 'deployments')
  if (!await maybeStat(platform, directory)) return null
  let lost: { record: DeploymentRecord; savedMs: number } | null = null
  for (const relative of await platform.listFiles(directory)) {
    if (!relative.endsWith('record.json')) continue
    const path = joinPath(directory, relative)
    try {
      const record = await readDeployment(platform, (JSON.parse(await platform.readText(path)) as DeploymentRecord).gameFolder)
      if (record?.status !== 'complete' || await isGameFolder(platform, record.gameFolder)) continue
      const savedMs = (await platform.stat(path)).modifiedMs
      if (!lost || savedMs > lost.savedMs) lost = { record, savedMs }
    } catch { /* Not a deployment to point the player at. */ }
  }
  return lost?.record ?? null
}

export async function scanDeployment(platform: Platform, gameFolder: string, content: ContentVersion, record: DeploymentRecord | null, signatures: ExistingSetupSignature[]): Promise<DeploymentScan> {
  const root = joinPath(gameFolder, 'game')
  const files = await platform.listFiles(root)
  await platform.resolveGamePaths(root, files)
  const { cache } = await dataPaths(platform, gameFolder)
  const stats = await platform.statMany(content.files.map((file) => joinPath(cache, file.sha256)))
  const sized = content.files.filter((file, i) => stats[i]?.kind === 'file' && stats[i]!.size === file.size)
  const hashes = await platform.hashMany(sized.map((file) => joinPath(cache, file.sha256)))
  const cachedFiles = sized.filter((file, i) => hashes[i] === file.sha256).map((file) => file.sha256)
  const ownedFiles = record?.status === 'complete' ? Object.keys(record.files) : []
  return { files, cachedFiles, ownedFiles, existingSetups: detectExistingSetups(signatures, files, ownedFiles) }
}

export function releaseAsset(file: ContentVersion['files'][number]): string {
  return `https://github.com/arnaudcouturier/lucent/releases/download/${file.release}/${file.sha256}`
}

async function undoDirectories(platform: Platform, gameFolder: string, created: string[]) {
  if (!created.length) return
  const root = joinPath(gameFolder, 'game')
  const directories = [...created].sort((a, b) => b.split('/').length - a.split('/').length)
  await platform.removeDirectoriesIfEmpty(await platform.resolveGamePaths(root, directories))
}

/**
 * Journal entries and game files handled per batch. A batch amortises the round trips, the game check and the
 * durable checkpoint across many files, which is most of what an install or uninstall of a thousand files costs.
 */
const FILE_BATCH = 96

/**
 * Undoes these journal entries, whose paths are all different, so their files can be put back together: each one is
 * removed if the step created it, or restored from its verified backup. The checks are the sequential undo's.
 */
async function undoEntries(platform: Platform, record: DeploymentRecord, backups: string, indices: number[]) {
  const work: { relative: string; before: string | null; after: string | null | undefined }[] = []
  for (const index of indices) {
    const entry = record.journal[index]
    // A carried-over preset is a user file once the deployment is complete; only a failed deployment takes it back.
    if (entry.registry) {
      const { userSid, name, before, after } = entry.registry
      await requireGameStopped(platform)
      const current = await platform.readUserGpuPreferences(userSid, name)
      const restored = restoreAutoHdr(current, before, after)
      if (restored !== current) {
        await requireGameStopped(platform)
        if (await platform.readUserGpuPreferences(userSid, name) !== current) {
          throw new Error('The per-game graphics preferences changed during recovery. Keep the journal and try recovery again.')
        }
        await platform.writeUserGpuPreferences(userSid, name, restored)
        if (await platform.readUserGpuPreferences(userSid, name) !== restored) {
          throw new Error('Windows did not restore the per-game Auto HDR preference. Keep the journal and try recovery again.')
        }
      }
      continue
    }
    if (record.uninstalling && entry.step?.kind === 'carry') continue
    if (!entry.step) throw new Error('The deployment journal is damaged.')
    for (const [relative, before] of Object.entries(entry.before).reverse()) work.push({ relative, before, after: entry.after[relative] })
  }
  if (!work.length) return
  const targets = await platform.resolveGamePaths(joinPath(record.gameFolder, 'game'), work.map((w) => w.relative))
  const stats = await platform.statMany(targets)
  const hashes = await platform.hashMany(targets.filter((_, k) => stats[k]))
  let hashed = 0
  const removals: string[] = []
  const restores: { relative: string; target: string; backup: string; replace: boolean }[] = []
  work.forEach(({ relative, before, after }, k) => {
    const current = stats[k] ? hashes[hashed++] : null
    if (current === before) return
    if (current !== after) {
      if (!record.uninstalling) throw new Error(`Recovery stopped to protect a changed user file: ${relative}`)
      // A file Lucent added stays Lucent's even after a mod rewrites it; a replaced original is newer than the deployment.
      if (before !== null && current !== null) return
    }
    if (before === null) removals.push(targets[k])
    else restores.push({ relative, target: targets[k], backup: before, replace: current !== null })
  })
  const backupHashes = [...new Set(restores.map((r) => r.backup))]
  const verified = await platform.hashMany(backupHashes.map((hash) => joinPath(backups, hash)))
  backupHashes.forEach((hash, k) => {
    if (verified[k] !== hash) throw new PlatformError('hash-mismatch', `Backup hash mismatch: ${restores.find((r) => r.backup === hash)!.relative}`)
  })
  await platform.removeMany(removals)
  await platform.copyMany(restores.map((r) => ({ from: joinPath(backups, r.backup), to: r.target, replace: r.replace })), parentPath(record.gameFolder))
}

export async function undoDeployment(platform: Platform, record: DeploymentRecord): Promise<void> {
  platform = await guardGameWrites(platform, record.gameFolder)
  const paths = await dataPaths(platform, record.gameFolder)
  const root = joinPath(record.gameFolder, 'game')
  const start = record.changeStart ?? 0
  // Flipping preallocated bytes needs no free space, so a full data disk cannot stop the undo.
  const checkpoint = (entries: number[] | 'all') => record.undoCheckpoints && start === 0
    ? platform.writeFileBytes(checkpointsPath(paths.record, record.undoCheckpoints.id), entries === 'all' ? [record.undoCheckpoints.size - 1] : entries, UNDONE)
    : platform.writeText(paths.record, JSON.stringify(record, null, 2))
  const activeRegistryEntries = new Set<number>()
  if (record.uninstalling) {
    const latestByPreference = new Map<string, { index: number; before: string | null; after: string | null }>()
    record.journal.forEach((entry, index) => {
      const registry = entry.registry
      if (!registry || registry.kind !== 'user-gpu-preferences' || entry.undone) return
      latestByPreference.set(`${registry.userSid}|${fileKey(registry.name)}`, { index, before: registry.before, after: registry.after })
    })
    for (const transition of latestByPreference.values()) {
      if (autoHdrDisableWasApplied(transition.before, transition.after)) activeRegistryEntries.add(transition.index)
    }
  }
  if (record.uninstalling && record.generatedFiles?.length) {
    const targets = await platform.resolveGamePaths(root, record.generatedFiles)
    const stats = await platform.statMany(targets)
    await platform.removeMany(targets.filter((_, i) => stats[i]?.kind === 'file'))
  }
  // Newest first, in batches whose entries touch different paths: within a batch no undo depends on another.
  // A batch interrupted before its checkpoint is simply undone again, since an undone file already matches `before`.
  for (let i = record.journal.length - 1; i >= start;) {
    const batch: number[] = []
    const touched = new Set<string>()
    for (; i >= start && batch.length < FILE_BATCH; i--) {
      const entry = record.journal[i]
      if (entry.undone || (record.uninstalling && entry.registry && !activeRegistryEntries.has(i))) continue
      const keys = Object.keys(entry.before).map(fileKey)
      if (keys.some((key) => touched.has(key))) break
      for (const key of keys) touched.add(key)
      batch.push(i)
    }
    if (!batch.length) continue
    await undoEntries(platform, record, paths.backups, batch)
    for (const index of batch) record.journal[index].undone = true
    await checkpoint(batch)
  }
  if (record.changeStart !== undefined) {
    record.journal.length = start
    delete record.changeStart
    if (record.changeDirectoryStart !== undefined) {
      await undoDirectories(platform, record.gameFolder, record.createdDirectories!.splice(record.changeDirectoryStart))
      delete record.changeDirectoryStart
    }
    record.status = 'complete'
  } else { await undoDirectories(platform, record.gameFolder, record.createdDirectories ?? []); record.status = 'rolled-back' }
  await checkpoint('all')
  // Every original is back in the game folder, so the player's copy has served its purpose.
  if (record.status === 'rolled-back') await removeReadableBackup(platform, record)
}

/** Every asset is verified before a journal or game-folder mutation; each intent is durable before its step. */
export async function deployContent(
  platform: Platform, gameFolder: string, content: ContentVersion, signatures: ExistingSetupSignature[], tier: Tier, includeReShade: boolean, profile: ProfileId | null,
  graphics: GpuAdapter, source: ContentSource, reviewedPaths: readonly string[], report: (progress: DeploymentProgress) => void, gameVersion: string | null = null,
  selection: PlanSelection = {},
): Promise<DeploymentRecord> {
  platform = await guardGameWrites(platform, gameFolder)
  const previous = await readDeployment(platform, gameFolder)
  if (previous && previous.status !== 'rolled-back') throw new Error('This game folder already has a deployment. Reopen Lucent to inspect it.')
  const scan = await scanDeployment(platform, gameFolder, content, null, signatures)
  const plan = planDeployment(content, tier, includeReShade, scan, profile, true, selection)
  assertReviewedTakeovers(plan, reviewedPaths)
  const paths = await dataPaths(platform, gameFolder)
  const present = new Set(scan.files.map(fileKey))
  const backupFolder = plan.filesToBackup.length ? await backupFolderName(platform, gameFolder) : undefined
  // An existing setup's log is backed up like its other files, so the one the mods write later is Lucent's to remove.
  const takenOver = new Set(plan.takenOver.map(fileKey))
  await cachePlannedFiles(platform, paths.cache, plan, scan.cachedFiles, source, report)
  await requireGameStopped(platform)
  const record: DeploymentRecord = {
    schemaVersion: 1, status: 'applying', gameFolder, tier: tier.id, graphics, contentVersion: content.id,
    includeReShade: plan.includeReShade, enabled: true, profile: plan.profile, frameGenerationMode: plan.frameGenerationMode, recipe: plan.recipe, journal: [], createdDirectories: [],
    cachedVersions: [cacheSnapshot(content, tier, plan.recipe, plan.files)],
    generatedFiles: plan.recipe.generatedFiles.map((p) => p.path).filter((p) => !present.has(fileKey(p)) || takenOver.has(fileKey(p))), undoCheckpoints: { id: crypto.randomUUID(), size: plan.steps.length + 1 }, ownedConfigs: {}, files: {},
    backupFolder,
  }
  const save = () => platform.writeText(paths.record, JSON.stringify(record, null, 2))
  // Reserve every undo checkpoint before the first game write. Updating one byte
  // needs no new file allocation even if a later journal write fills Lucent's disk.
  await platform.writeText(checkpointsPath(paths.record, record.undoCheckpoints!.id), '0'.repeat(record.undoCheckpoints!.size))
  await save()
  await discardCheckpoints(platform, paths.record, previous?.undoCheckpoints)
  try {
    // Scan listed every file from before the deployment that it overwrites or removes; those are the only ones Lucent takes over.
    const originals = new Set(reviewedPaths.map(fileKey))
    if (backupFolder) await copyReadableBackup(platform, gameFolder, await readableBackupPath(platform, gameFolder, backupFolder), plan.filesToBackup, report)
    await applySteps({ platform, record, save, report, owned: originals, firstDeployment: true, from: backupFolder ? 0.5 : 0.4 }, plan.steps)
    record.files = await stampFiles(platform, record, plan.expectedFiles, report)
    record.ownedConfigs = await readOwnedConfigs(platform, gameFolder, plan)
    // The checkpoints cover only this deployment's own steps; later journal entries are undone through the record.
    // Every file was just hashed, so the record is healthy for this game version and the next check needn't hash again.
    const complete: DeploymentRecord = { ...record, status: 'complete', undoCheckpoints: undefined, gameVersion }
    await platform.writeText(paths.record, JSON.stringify(complete, null, 2))
    await discardCheckpoints(platform, paths.record, record.undoCheckpoints)
    report({ phase: 'checking', progress: 1, file: null })
    return complete
  } catch (error) {
    try { await undoDeployment(platform, record) } catch (recoveryError) {
      throw new DeploymentError(error, true, recoveryError)
    }
    throw new DeploymentError(error, false)
  }
}

/**
 * Files fetched at once. A content version is about a thousand files, most a few kilobytes, so one at a time
 * spends nearly all its time waiting on GitHub's per-file round trips; eight hide that without hammering it.
 */
const PARALLEL_DOWNLOADS = 8
/** Waits before retrying a download that failed on the network; a dropped connection usually recovers at once. */
const DOWNLOAD_RETRY_MS = [250, 1000]

/** Runs `work` over the items, `limit` at a time. Stops starting new ones after a failure, and throws it once every running one has settled. */
async function inParallel<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0
  let failure: { error: unknown } | null = null
  const worker = async () => {
    while (!failure && next < items.length) {
      const item = items[next++]
      try { await work(item) } catch (error) { failure ??= { error } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (failure) throw (failure as { error: unknown }).error
}

/** Downloads files into the cache, several at once and the largest first, reporting the bytes received of their total. */
async function downloadFiles(platform: Platform, cache: string, files: ContentFile[], source: ContentSource, progress: (received: number, total: number) => void) {
  const unique = [...new Map(files.map((f) => [f.sha256, f])).values()].sort((a, b) => b.size - a.size)
  const total = unique.reduce((sum, f) => sum + f.size, 0)
  const received = new Map<string, number>()
  let bytes = 0
  progress(0, total)
  await inParallel(unique, PARALLEL_DOWNLOADS, (file) => cacheFile(platform, cache, file, source, (count) => {
    const now = Math.min(count, file.size)
    bytes += now - (received.get(file.sha256) ?? 0)
    received.set(file.sha256, now)
    progress(bytes, total)
  }))
  await verifyCached(platform, cache, unique)
}

/** Checks cached files against their size and hash, a batch at a time, and removes the first damaged one it finds. */
async function verifyCached(platform: Platform, cache: string, files: ContentFile[]) {
  for (let i = 0; i < files.length; i += FILE_BATCH) {
    const batch = files.slice(i, i + FILE_BATCH)
    const paths = batch.map((file) => joinPath(cache, file.sha256))
    const stats = await platform.statMany(paths)
    const wrongSize = batch.findIndex((file, k) => stats[k]?.kind !== 'file' || stats[k]!.size !== file.size)
    const hashes = wrongSize < 0 ? await platform.hashMany(paths) : []
    const damaged = wrongSize >= 0 ? wrongSize : batch.findIndex((file, k) => hashes[k] !== file.sha256)
    if (damaged >= 0) {
      await platform.removeFile(paths[damaged])
      throw new PlatformError('hash-mismatch', 'A downloaded file failed its hash check. The game folder has not been changed.', paths[damaged])
    }
  }
}

/** Downloads every planned file the cache lacks, verifying each, before the game folder changes. */
async function cachePlannedFiles(platform: Platform, cache: string, plan: Plan, cachedFiles: string[], source: ContentSource, report: (progress: DeploymentProgress) => void) {
  const cached = new Set(cachedFiles)
  report({ phase: 'downloading', progress: 0, file: null })
  await verifyCached(platform, cache, plan.files.filter((f) => cached.has(f.sha256)))
  await downloadFiles(platform, cache, plan.files.filter((f) => !cached.has(f.sha256)), source, (done, total) => report({ phase: 'downloading', progress: total ? done / total * 0.4 : 0.4, file: null, done, total }))
}

/**
 * A first deployment's readable backup: a copy of every original it will replace or remove, made before the first game
 * write as its own stage. The journal backs each file up again, by hash, right before its step; uninstall uses only that.
 */
async function copyReadableBackup(platform: Platform, gameFolder: string, folder: string, originals: string[], report: (progress: DeploymentProgress) => void) {
  const paths = await platform.resolveGamePaths(joinPath(gameFolder, 'game'), originals)
  const stats = await platform.statMany(paths)
  const copies = originals.flatMap((relative, i) => stats[i]?.kind === 'file' ? [{ from: paths[i], to: joinPath(folder, relative), replace: true }] : [])
  for (let i = 0; i < copies.length; i += FILE_BATCH) {
    report({ phase: 'backing-up', progress: 0.4 + i / copies.length * 0.1, file: null, done: i, total: copies.length })
    await platform.copyMany(copies.slice(i, i + FILE_BATCH))
  }
}

/** Records the directories these paths need that don't exist yet, before any step can create them. */
async function recordCreatedDirectories(platform: Platform, record: DeploymentRecord, root: string, relatives: string[]) {
  const known = new Set(record.createdDirectories!.map(fileKey))
  const candidates: string[] = []
  for (const relative of relatives) {
    const parts = relative.replace(/\\/g, '/').split('/')
    for (let length = 1; length < parts.length; length++) {
      const directory = parts.slice(0, length).join('/')
      if (!known.has(fileKey(directory))) { known.add(fileKey(directory)); candidates.push(directory) }
    }
  }
  if (!candidates.length) return
  const stats = await platform.statMany(await platform.resolveGamePaths(root, candidates))
  candidates.forEach((directory, i) => { if (!stats[i]) record.createdDirectories!.push(directory) })
}

type FileStep = Extract<PlanStep, { kind: 'copy' | 'delete' }>
const fileStepPath = (step: FileStep) => step.kind === 'copy' ? step.to : step.path

/**
 * Applies copies and deletions of different paths together: every file they replace or remove is hashed and backed up,
 * all their intents are journaled in one durable write, then the files change at once. Recovery is unchanged: a
 * journaled step that never ran still matches `before`, so undoing it does nothing.
 */
async function applyFileSteps({ platform, record, save, owned, firstDeployment }: Execution, batch: FileStep[]) {
  const { gameFolder } = record
  const { backups, cache } = await dataPaths(platform, gameFolder)
  const root = joinPath(gameFolder, 'game')
  const relatives = batch.map(fileStepPath)
  relatives.forEach(assertGamePath)
  await recordCreatedDirectories(platform, record, root, relatives)
  const targets = await platform.resolveGamePaths(root, relatives)
  const stats = await platform.statMany(targets)
  stats.forEach((stat, i) => {
    if (stat && (!owned.has(fileKey(relatives[i])) || stat.kind !== 'file')) throw firstDeployment
      ? new UnreviewedFilesError([relatives[i]]) : new Error(`Protecting a user file: ${relatives[i]}. The folder changed since Review.`)
  })
  const hashes = await platform.hashMany(targets.filter((_, i) => stats[i]))
  let hashed = 0
  const before = stats.map((stat) => stat ? hashes[hashed++] : null)
  // One backup per distinct content, verified before any intent relies on it.
  const toBackUp = new Map<string, string>()
  before.forEach((hash, i) => { if (hash && !toBackUp.has(hash)) toBackUp.set(hash, targets[i]) })
  if (toBackUp.size) {
    const items = [...toBackUp].map(([hash, from]) => ({ from, to: joinPath(backups, hash), replace: true }))
    await platform.copyMany(items)
    const verified = await platform.hashMany(items.map((item) => item.to))
    ;[...toBackUp.keys()].forEach((hash, i) => {
      if (verified[i] !== hash) throw new PlatformError('hash-mismatch', `Backup hash mismatch: ${relatives[before.indexOf(hash)]}`)
    })
  }
  batch.forEach((step, i) => {
    const entryBefore: JournalEntry['before'] = Object.create(null)
    entryBefore[relatives[i]] = before[i]
    record.journal.push({ step, before: entryBefore, after: { [relatives[i]]: step.kind === 'copy' ? step.file : null } })
  })
  await save()
  await requireGameStopped(platform)
  // Resolve again after the durable journal write, immediately before the files change.
  const destinations = await platform.resolveGamePaths(root, relatives)
  await platform.removeMany(destinations.filter((_, i) => batch[i].kind === 'delete'))
  await platform.copyMany(batch.flatMap((step, i) => step.kind === 'copy' ? [{ from: joinPath(cache, step.file), to: destinations[i], replace: before[i] !== null }] : []), parentPath(gameFolder))
  for (const relative of relatives) owned.add(fileKey(relative))
}

interface Execution {
  platform: Platform
  /** Journals each step, with its backup, before the step takes effect. */
  record: DeploymentRecord
  save: () => Promise<void>
  report: (progress: DeploymentProgress) => void
  /** Game-folder paths Lucent may overwrite or remove; every other existing file is the player's. */
  owned: Set<string>
  /** A new user file during a first deployment returns the player to Scan after recovery. */
  firstDeployment?: boolean
  /** Where the steps start on the overall progress, which they carry to 0.8. */
  from?: number
}

/** Applies planned steps through the journal: each intent and its verified backup are durable before the step. */
async function applySteps(execution: Execution, steps: PlanStep[]) {
  const { report, from = 0.4 } = execution
  for (let i = 0; i < steps.length;) {
    report({ phase: 'applying', progress: from + i / steps.length * (0.8 - from), file: null, done: i, total: steps.length })
    // Consecutive copies and deletions of different paths don't depend on each other, so they run as a batch. Every
    // other step reads what came before it (a rename, a config edit, a carried preset) and runs alone.
    const batch: FileStep[] = []
    const paths = new Set<string>()
    for (let step = steps[i]; (step?.kind === 'copy' || step?.kind === 'delete') && !paths.has(fileKey(fileStepPath(step))) && batch.length < FILE_BATCH; step = steps[i + batch.length]) {
      paths.add(fileKey(fileStepPath(step)))
      batch.push(step)
    }
    if (batch.length) { await applyFileSteps(execution, batch); i += batch.length }
    else { await applyStep(execution, steps[i]); i++ }
  }
}

/** One step on its own, journaled with its verified backups before it takes effect. */
async function applyStep({ platform, record, save, owned, firstDeployment }: Execution, step: PlanStep) {
  const { gameFolder } = record
  const { backups, cache } = await dataPaths(platform, gameFolder)
  const root = joinPath(gameFolder, 'game')
  const relatives = stepWritePaths(step)
  const before: JournalEntry['before'] = Object.create(null)
  for (const relative of relatives) assertGamePath(relative)
  await recordCreatedDirectories(platform, record, root, relatives)
  for (const relative of relatives) {
    const path = await platform.resolveGamePath(root, relative)
    const stat = await maybeStat(platform, path)
    if (stat && (!owned.has(fileKey(relative)) || stat.kind !== 'file')) throw firstDeployment
      ? new UnreviewedFilesError([relative]) : new Error(`Protecting a user file: ${relative}. The folder changed since Review.`)
    before[relative] = stat ? await platform.hashFile(path) : null
    if (before[relative]) {
      const backup = joinPath(backups, before[relative]!)
      await platform.copyFile(path, backup)
      if (await platform.hashFile(backup) !== before[relative]) throw new PlatformError('hash-mismatch', `Backup hash mismatch: ${relative}`)
    }
  }
  let configText: string | null = null
  if (step.kind === 'ini_set') {
    const config = readIni(await platform.readText(await platform.resolveGamePath(root, step.file)))
    config.set(step.section, step.key, step.value)
    configText = config.toString()
  }
  const after: JournalEntry['after'] = step.kind === 'copy' ? { [step.to]: step.file }
    : step.kind === 'carry' ? { [step.to]: await platform.hashFile(await platform.resolveGamePath(root, step.from)) }
    : step.kind === 'rename' ? { [step.from]: null, [step.to]: before[step.from] }
    : step.kind === 'ini_set' ? { [step.file]: await hashText(configText!) }
    : step.kind === 'write' ? { [step.path]: await hashText(step.text) } : { [step.path]: null }
  if (step.kind === 'rename' && !before[step.from]) throw new Error(`Rename source is missing: ${step.from}`)
  record.journal.push({ step, before, after })
  await save()
  await requireGameStopped(platform)
  // Resolve again after the durable journal write, immediately before the mutation.
  if (step.kind === 'carry') await platform.copyFile(await platform.resolveGamePath(root, step.from), await platform.resolveGamePath(root, step.to), false, parentPath(gameFolder))
  else if (step.kind === 'copy') await platform.copyFile(joinPath(cache, step.file), await platform.resolveGamePath(root, step.to), before[step.to] !== null, parentPath(gameFolder))
  else if (step.kind === 'rename') await platform.renameFile(await platform.resolveGamePath(root, step.from), await platform.resolveGamePath(root, step.to), before[step.to] !== null)
  else if (step.kind === 'ini_set') await platform.writeText(await platform.resolveGamePath(root, step.file), configText!, parentPath(gameFolder))
  else if (step.kind === 'write') await platform.writeText(await platform.resolveGamePath(root, step.path), step.text, parentPath(gameFolder))
  else await platform.removeFile(await platform.resolveGamePath(root, step.path))
  for (const relative of relatives) owned.add(fileKey(relative))
}

/** Checks every file the plan expects against the hash the journal last wrote there, and stamps it. */
async function stampFiles(platform: Platform, record: DeploymentRecord, expectedFiles: Plan['expectedFiles'], report: (progress: DeploymentProgress) => void) {
  const root = joinPath(record.gameFolder, 'game')
  const lastWrite = new Map<string, string | null>()
  for (const entry of record.journal) for (const [path, hash] of Object.entries(entry.after)) lastWrite.set(fileKey(path), hash)
  const files: Record<string, FileStamp> = {}
  for (let i = 0; i < expectedFiles.length; i += FILE_BATCH) {
    report({ phase: 'checking', progress: 0.8 + i / expectedFiles.length * 0.2, file: null, done: i, total: expectedFiles.length })
    const batch = expectedFiles.slice(i, i + FILE_BATCH)
    const paths = await platform.resolveGamePaths(root, batch.map((file) => file.path))
    const stats = await platform.statMany(paths)
    const missing = batch.findIndex((_, k) => !stats[k])
    if (missing >= 0) throw new PlatformError('not-found', `The deployed file is missing: ${batch[missing].path}`, paths[missing])
    const hashes = await platform.hashMany(paths)
    batch.forEach((file, k) => {
      if (hashes[k] !== (file.sha256 ?? lastWrite.get(fileKey(file.path)))) throw new PlatformError('hash-mismatch', `The deployed file failed its hash check: ${file.path}`)
      files[file.path] = { ...stats[k]!, sha256: hashes[k] }
    })
  }
  return files
}

async function readOwnedConfigs(platform: Platform, gameFolder: string, plan: Plan) {
  const root = joinPath(gameFolder, 'game')
  const configs: Record<string, string> = {}
  for (const config of plan.recipe.ownedConfigs) configs[config.path] = await platform.readText(await platform.resolveGamePath(root, config.path))
  return configs
}

/**
 * What the new version ships for each owned config: the cached file it copies there, with every
 * `ini_set` for that file (the recipe's, then the selected profile's) applied in plan order.
 * Only config files are read as text; other assets are tracked by hash through renames.
 */
async function incomingConfigTexts(platform: Platform, cache: string, plan: Plan, record: DeploymentRecord): Promise<Map<string, string>> {
  type Entry = { hash?: string; text?: string }
  const virtual = new Map<string, Entry>()
  const configKeys = new Set(plan.recipe.ownedConfigs.map((c) => fileKey(c.path)))
  const baseText = (path: string) => {
    const key = Object.keys(record.ownedConfigs).find((p) => fileKey(p) === fileKey(path))
    return key === undefined ? undefined : record.ownedConfigs[key]
  }
  for (const step of plan.steps) {
    if (step.kind === 'copy') virtual.set(fileKey(step.to), { hash: step.file })
    else if (step.kind === 'rename') {
      const entry = virtual.get(fileKey(step.from))
      if (entry) { virtual.set(fileKey(step.to), entry); virtual.delete(fileKey(step.from)) }
    } else if (step.kind === 'delete') virtual.delete(fileKey(step.path))
    else if (step.kind === 'ini_set' && configKeys.has(fileKey(step.file))) {
      const key = fileKey(step.file)
      let entry = virtual.get(key)
      if (!entry) {
        const base = baseText(step.file)
        if (base === undefined) continue
        entry = { text: base }
        virtual.set(key, entry)
      }
      if (entry.text === undefined) entry.text = await platform.readText(joinPath(cache, entry.hash!))
      const config = readIni(entry.text)
      config.set(step.section, step.key, step.value)
      entry.text = config.toString()
      delete entry.hash
    }
  }
  const result = new Map<string, string>()
  for (const config of plan.recipe.ownedConfigs) {
    const entry = virtual.get(fileKey(config.path))
    if (!entry) continue
    result.set(fileKey(config.path), entry.text ?? await platform.readText(joinPath(cache, entry.hash!)))
  }
  return result
}

/** `reshade-presets/Example.ini` -> `reshade-presets/Example (my edits).ini`, numbered while taken. */
function myEditsPath(presetPath: string, taken: Set<string>): string {
  const parts = presetPath.replace(/\\/g, '/').split('/')
  const name = parts.at(-1)!
  const dot = name.lastIndexOf('.')
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  const folder = parts.slice(0, -1).join('/')
  const candidate = (suffix: string) => folder ? `${folder}/${stem} (${suffix})${extension}` : `${stem} (${suffix})${extension}`
  let path = candidate('my edits')
  for (let n = 2; taken.has(fileKey(path)); n++) path = candidate(`my edits ${n}`)
  return path
}

/** The game-folder path a step writes, or null for steps that only remove a file or carry one over. */
function writtenPath(step: PlanStep): string | null {
  return step.kind === 'copy' || step.kind === 'rename' ? step.to : step.kind === 'ini_set' ? step.file : step.kind === 'write' ? step.path : null
}

/**
 * Moves a complete deployment to another content version, planned from the deployment as it stands: downloads only the
 * files the cache lacks, applies the recipe, and deletes the files the version no longer deploys, all through the journal.
 * Owned configs are merged key by key (see `mergeIni`) and backed up first; an edited shipped preset is kept when
 * Lucent's version is unchanged, or saved as "(my edits)" when it changed too. Enabled or Disabled, and the
 * performance profile where the tier still has it, are kept. Given another tier and `graphics`, it switches the deployment
 * to that tier's recipe the same way. A failure or interruption undoes only the update.
 */
export async function updateDeployment(
  platform: Platform, gameFolder: string, content: ContentVersion, tier: Tier, source: ContentSource, report: (progress: DeploymentProgress) => void,
  graphics?: GpuAdapter, screen: ResolvedScreen | null = null,
): Promise<DeploymentRecord> {
  platform = await guardGameWrites(platform, gameFolder)
  const record = await readDeployment(platform, gameFolder)
  if (!record || record.status !== 'complete') throw new Error('Recover the deployment before updating it.')
  // No existing-setup signatures: without a Review to explain a takeover, a setup that appeared since blocks the update instead.
  const scan = await scanDeployment(platform, gameFolder, content, record, [])
  const targetRecipe = content.tiers[tier.id]
  const gpuName = graphics?.name ?? record.graphics.name
  const profile = selectProfileForUpdate(targetRecipe, record.recipe, record.profile ?? null, gpuName)
  const options = frameGenerationOptionsForGpu(content.tiers[tier.id]?.frameGenerationOptions ?? [], graphics?.name ?? record.graphics.name)
  const oldOptions = frameGenerationOptionsForGpu(record.recipe.frameGenerationOptions ?? [], record.graphics.name)
  const currentMode = oldOptions.length ? await frameGenerationModeOnDisk(platform, record) : null
  const frameGenerationMode = !options.length ? null
    : !oldOptions.length || (currentMode && !options.some((option) => option.id === currentMode))
      ? defaultFrameGenerationMode(options, screen?.refreshHz ?? 60) : currentMode
  const currentHdr = record.recipe.hdrOptions?.length ? await hdrStateOnDisk(platform, record) : null
  const hdrSettingsOverride = currentHdr?.mode === null && targetRecipe.hdrOptions?.length
    ? await declaredSettingsOnDisk(platform, record, targetRecipe.hdrOptions.flatMap((option) => option.settings)) : undefined
  const hdrSelection: Pick<PlanSelection, 'hdrMode' | 'hdrActive'> = currentHdr && targetRecipe.hdrOptions?.length
    && (currentHdr.mode === null || targetRecipe.hdrOptions.some((option) => option.id === currentHdr.mode))
    ? { hdrMode: currentHdr.mode, hdrActive: currentHdr.active } : {}
  // An update never moves a screen-derived value Lucent wrote before; only a key the content adds is computed from the screen.
  const screenSettingsKept = (targetRecipe.screenDerivedSettings ?? []).flatMap((setting) => {
    const written = Object.entries(record.ownedConfigs).find(([path]) => fileKey(path) === fileKey(setting.file))
    const value = written ? readIni(written[1]).get(setting.section, setting.key) : undefined
    return value === undefined ? [] : [{ file: setting.file, section: setting.section, key: setting.key, value }]
  })
  const selection: PlanSelection = { gpuName, outputHeight: screen?.height, frameGenerationOptions: options, frameGenerationMode, hdrOn: screen?.hdrOn ?? false, hdrSettingsOverride, screen, screenSettingsKept, ...hdrSelection }
  const plan = planDeployment(content, tier, record.includeReShade, scan, profile, record.enabled, selection)
  if (plan.unclaimedPaths.length) throw new Error(`These user files would be replaced: ${plan.unclaimedPaths.join(', ')}. Move them aside before updating.`)
  const paths = await dataPaths(platform, gameFolder)
  await cachePlannedFiles(platform, paths.cache, plan, scan.cachedFiles, source, report)
  await requireGameStopped(platform)
  // `record` journals the update while it applies; `updated` replaces it once the new version is in place.
  const updated = structuredClone(record)
  record.status = 'applying'
  record.changeStart = record.journal.length
  record.createdDirectories ??= []
  record.changeDirectoryStart = record.createdDirectories.length
  const save = () => platform.writeText(paths.record, JSON.stringify(record, null, 2))
  await save()
  try {
    const root = joinPath(gameFolder, 'game')
    const incomingTexts = await incomingConfigTexts(platform, paths.cache, plan, record)
    const resetKeys = plan.recipe.resetKeys ?? []
    // Merge each owned config Lucent wrote before and that is still on disk, following the new layout.
    const mergedTexts = new Map<string, string>()
    for (const config of plan.recipe.ownedConfigs) {
      const key = fileKey(config.path)
      const incomingText = incomingTexts.get(key)
      const basePath = Object.keys(record.ownedConfigs).find((p) => fileKey(p) === key)
      if (incomingText === undefined || basePath === undefined) continue
      const diskPath = await platform.resolveGamePath(root, config.path)
      if ((await maybeStat(platform, diskPath))?.kind !== 'file') continue
      const diskText = await platform.readText(diskPath)
      if (diskText.includes('\0')) continue
      let mergedText = mergeIni(record.ownedConfigs[basePath], diskText, incomingText, resetKeys.filter((k) => fileKey(k.file) === key))
      if (currentMode === null && oldOptions.length) {
        // A Custom combination has no managed target to apply. Keep its frame-generation keys
        // verbatim while the rest of the config follows the incoming recipe.
        const onDisk = readIni(diskText)
        const merged = readIni(mergedText)
        for (const setting of oldOptions.flatMap((option) => [...option.settings, ...(option.hdrSettings ?? [])])) {
          if (fileKey(setting.file) !== key) continue
          const value = onDisk.get(setting.section, setting.key)
          if (value === undefined) merged.remove(setting.section, setting.key)
          else merged.set(setting.section, setting.key, value)
        }
        mergedText = merged.toString()
      }
      mergedTexts.set(key, mergedText)
    }
    let steps: PlanStep[] = []
    const emittedMerged = new Set<string>()
    for (const step of plan.steps) {
      const target = writtenPath(step)
      const mergedKey = target && mergedTexts.has(fileKey(target)) ? fileKey(target) : null
      if (mergedKey) {
        if (!emittedMerged.has(mergedKey)) {
          steps.push({ kind: 'write', path: plan.recipe.ownedConfigs.find((c) => fileKey(c.path) === mergedKey)!.path, text: mergedTexts.get(mergedKey)! })
          emittedMerged.add(mergedKey)
        }
        continue
      }
      steps.push(step)
    }
    for (const [key, text] of mergedTexts) {
      if (!emittedMerged.has(key)) steps.push({ kind: 'write', path: plan.recipe.ownedConfigs.find((c) => fileKey(c.path) === key)!.path, text })
    }
    let expectedFiles = plan.expectedFiles.map((f) => mergedTexts.has(fileKey(f.path)) ? { path: f.path, sha256: null } : f)
    // Shipped presets: keep an edited one Lucent did not change; preserve one it changed too as "(my edits)".
    const keptPresets: { path: string; sha256: string }[] = []
    const preservedPresets = new Map<string, PlanStep>()
    const taken = new Set([...scan.files.map(fileKey), ...plan.expectedFiles.map((f) => fileKey(f.path))])
    for (const preset of plan.recipe.shippedPresets) {
      const key = fileKey(preset.path)
      const stampedPath = Object.keys(record.files).find((p) => fileKey(p) === key)
      if (!stampedPath || !record.recipe.shippedPresets.some((p) => fileKey(p.path) === key)) continue
      const baseHash = record.files[stampedPath].sha256
      const diskPath = await platform.resolveGamePath(root, preset.path)
      if ((await maybeStat(platform, diskPath))?.kind !== 'file') continue
      const diskHash = await platform.hashFile(diskPath)
      if (diskHash === baseHash) continue
      const copyStep = plan.steps.find((s) => s.kind === 'copy' && fileKey(s.to) === key)
      const incomingHash = copyStep?.kind === 'copy' ? copyStep.file : plan.expectedFiles.find((f) => fileKey(f.path) === key)?.sha256 ?? null
      if (!incomingHash) continue
      if (incomingHash === baseHash) keptPresets.push({ path: preset.path, sha256: incomingHash })
      else if (diskHash !== incomingHash) {
        const destination = myEditsPath(preset.path, taken)
        taken.add(fileKey(destination))
        preservedPresets.set(key, { kind: 'carry', from: preset.path, to: destination })
      }
    }
    if (keptPresets.length) {
      const kept = new Set(keptPresets.map((p) => fileKey(p.path)))
      const stagingSources = new Set(steps.filter((s) => s.kind === 'rename' && kept.has(fileKey(s.to))).map((s) => fileKey((s as Extract<PlanStep, { kind: 'rename' }>).from)))
      steps = steps.filter((step) => {
        const target = writtenPath(step)
        return !(target && (kept.has(fileKey(target)) || stagingSources.has(fileKey(target))))
      })
      expectedFiles = expectedFiles.filter((f) => !kept.has(fileKey(f.path)))
    }
    if (preservedPresets.size) {
      const withPreserved: PlanStep[] = []
      for (const step of steps) {
        const target = writtenPath(step)
        if (target && preservedPresets.has(fileKey(target))) {
          withPreserved.push(preservedPresets.get(fileKey(target))!)
          preservedPresets.delete(fileKey(target))
        }
        withPreserved.push(step)
      }
      steps = withPreserved
    }
    await applySteps({ platform, record, save, report, owned: new Set(Object.keys(record.files).map(fileKey)) }, steps)
    const files = await stampFiles(platform, record, expectedFiles, report)
    for (const kept of keptPresets) {
      const path = await platform.resolveGamePath(root, kept.path)
      files[kept.path] = { ...await platform.stat(path), sha256: kept.sha256 }
    }
    const ownedConfigs: Record<string, string> = {}
    for (const config of plan.recipe.ownedConfigs) ownedConfigs[config.path] = incomingTexts.get(fileKey(config.path)) ?? await platform.readText(await platform.resolveGamePath(root, config.path))
    const generated = record.generatedFiles ?? []
    const present = new Set(scan.files.map(fileKey))
    Object.assign(updated, {
      tier: tier.id, graphics: graphics ?? record.graphics,
      contentVersion: content.id, includeReShade: plan.includeReShade, profile: plan.profile,
      frameGenerationMode: plan.frameGenerationMode, recipe: plan.recipe,
      // Another tier's recipes can't be rolled back to on this graphics card.
      cachedVersions: [cacheSnapshot(content, tier, plan.recipe, plan.files), ...(record.cachedVersions ?? []).filter((v) => v.content.id !== content.id && v.tier.id === tier.id)].slice(0, 3),
      // A tier switch on the same content version keeps the player's pin.
      pinned: content.id === record.contentVersion ? record.pinned : content.id < record.contentVersion,
      pendingSelection: { skip: content.id < record.contentVersion ? record.contentVersion : null },
      journal: record.journal, createdDirectories: record.createdDirectories,
      files, ownedConfigs,
      generatedFiles: [...generated, ...plan.recipe.generatedFiles.map((p) => p.path)
        .filter((p) => !present.has(fileKey(p)) && !generated.some((g) => fileKey(g) === fileKey(p)))],
    } satisfies Partial<DeploymentRecord>)
    await platform.writeText(paths.record, JSON.stringify(updated, null, 2))
    report({ phase: 'checking', progress: 1, file: null })
    return updated
  } catch (error) {
    try { await undoDeployment(platform, record) } catch (recoveryError) {
      throw new DeploymentError(error, true, recoveryError)
    }
    throw new DeploymentError(error, false)
  }
}

/** Downloads a content asset into the cache, or copies it from local dev content; `downloadFiles` verifies it. */
async function cacheFile(platform: Platform, cache: string, file: ContentFile, source: ContentSource, progress: (received: number) => void) {
  const path = joinPath(cache, file.sha256)
  if (source.kind === 'local') await platform.copyFile(joinPath(source.filesDirectory, file.sha256), path)
  else for (let attempt = 0; ; attempt++) {
    try { await platform.downloadFile(releaseAsset(file), path, progress); break } catch (error) {
      if (!(error instanceof PlatformError && error.kind === 'network') || attempt >= DOWNLOAD_RETRY_MS.length) throw error
      progress(0)
      await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_RETRY_MS[attempt]))
    }
  }
  progress(file.size)
}

/**
 * Restores the drifted files to what Lucent last wrote, through the journal, against the deployed content version.
 * Deployed files come back from the cache, downloading only what is missing; an owned config comes back as its last-written copy.
 * Disabled entry files are restored under their disabled names, so Repair keeps the deployment Disabled.
 */
export async function repairDeployment(
  platform: Platform, gameFolder: string, drifted: string[], content: ContentVersion | null, source: ContentSource | null, report: (progress: DeploymentProgress) => void,
): Promise<DeploymentRecord> {
  platform = await guardGameWrites(platform, gameFolder)
  const record = await readDeployment(platform, gameFolder)
  if (!record || record.status !== 'complete') throw new Error('Recover the deployment before repairing it.')
  const paths = await dataPaths(platform, gameFolder)
  const root = joinPath(gameFolder, 'game')
  const configFor = (relative: string) => Object.keys(record.ownedConfigs).find((p) => fileKey(p) === fileKey(relative))
  const targets = drifted.map((relative) => {
    const stamped = Object.keys(record.files).find((p) => fileKey(p) === fileKey(relative))
    if (!stamped) throw new Error(`Repair found a file the deployment does not own: ${relative}`)
    const config = configFor(stamped)
    return { relative: stamped, config: config === undefined ? null : record.ownedConfigs[config], sha256: record.files[stamped].sha256 }
  })
  for (const target of targets) if (target.config !== null) target.sha256 = await hashText(target.config)
  const assets = [...new Set(targets.filter((t) => t.config === null).map((t) => t.sha256))]
  const missing: ContentFile[] = []
  for (const asset of assets) {
    const cached = joinPath(paths.cache, asset)
    if ((await maybeStat(platform, cached))?.kind === 'file' && await platform.hashFile(cached) === asset) continue
    const file = content?.files.find((f) => f.sha256 === asset)
    if (!file || !source) throw new PlatformError('network', 'Lucent couldn’t download a content file for the repair.')
    missing.push(file)
  }
  // A missing asset without a source already stopped the repair above.
  await downloadFiles(platform, paths.cache, missing, source!, (done, total) => report({ phase: 'downloading', progress: total ? done / total * 0.4 : 0.4, file: null, done, total }))
  await requireGameStopped(platform)
  // `record` journals the repair while it applies; `repaired` replaces it once every file is back.
  const repaired = structuredClone(record)
  record.status = 'applying'
  record.changeStart = record.journal.length
  const save = () => platform.writeText(paths.record, JSON.stringify(record, null, 2))
  await save()
  try {
    for (let i = 0; i < targets.length; i++) {
      const { relative, config, sha256 } = targets[i]
      report({ phase: 'applying', progress: 0.4 + i / targets.length * 0.5, file: relative, done: i, total: targets.length })
      const path = await platform.resolveGamePath(root, relative)
      const stat = await maybeStat(platform, path)
      if (stat && stat.kind !== 'file') throw new Error(`Protecting a user folder: ${relative}`)
      const before = stat ? await platform.hashFile(path) : null
      if (before) {
        const backup = joinPath(paths.backups, before)
        await platform.copyFile(path, backup)
        if (await platform.hashFile(backup) !== before) throw new PlatformError('hash-mismatch', `Backup hash mismatch: ${relative}`)
      }
      record.journal.push({ step: { kind: 'copy', file: sha256, to: relative }, before: { [relative]: before }, after: { [relative]: sha256 } })
      await save()
      await requireGameStopped(platform)
      const target = await platform.resolveGamePath(root, relative)
      if (config !== null) await platform.writeText(target, config, parentPath(gameFolder))
      else await platform.copyFile(joinPath(paths.cache, sha256), target, before !== null, parentPath(gameFolder))
      if (await platform.hashFile(target) !== sha256) throw new PlatformError('hash-mismatch', `The repaired file failed its hash check: ${relative}`)
      repaired.files[relative] = { ...await platform.stat(target), sha256 }
    }
    report({ phase: 'checking', progress: 1, file: null })
    repaired.journal = record.journal
    await platform.writeText(paths.record, JSON.stringify(repaired, null, 2))
    return repaired
  } catch (error) {
    try { await undoDeployment(platform, record) } catch (recoveryError) {
      throw new DeploymentError(error, true, recoveryError)
    }
    throw new DeploymentError(error, false)
  }
}

/** The game-folder files that were there before the deployment and that uninstall puts back: each path whose first step found a file. */
export function replacedOriginals(record: Pick<DeploymentRecord, 'journal'>): string[] {
  const seen = new Set<string>()
  const originals: string[] = []
  for (const entry of record.journal) {
    for (const [path, before] of Object.entries(entry.before)) {
      if (seen.has(fileKey(path))) continue
      seen.add(fileKey(path))
      if (before !== null) originals.push(path)
    }
  }
  return originals
}

/** Undoes a complete deployment and removes what its mods generated, leaving the folder vanilla. */
export async function uninstallDeployment(platform: Platform, gameFolder: string): Promise<void> {
  platform = await guardGameWrites(platform, gameFolder)
  const record = await readDeployment(platform, gameFolder)
  if (!record || record.status !== 'complete') throw new Error('There is no deployment to uninstall.')
  const { record: path } = await dataPaths(platform, gameFolder)
  record.status = 'applying'
  record.uninstalling = true
  // From here on, an interrupted uninstall is finished by recovery at the next start.
  await platform.writeText(path, JSON.stringify(record, null, 2))
  try { await undoDeployment(platform, record) } catch (error) {
    throw new DeploymentError(error, true, error)
  }
}

/**
 * Puts back the per-game Windows Auto HDR value that the deployment's journal says it turned off. Uninstalling Lucent
 * from Settings → Apps calls it when the game files stay, so nothing is left behind once Lucent's data folder goes.
 */
export async function restoreAutoHdrPreference(platform: Platform, record: DeploymentRecord, observe?: (running: boolean) => void): Promise<boolean> {
  const name = await platform.resolveGamePath(joinPath(record.gameFolder, 'game'), 'ffxiv_dx11.exe')
  const transitions = record.journal.flatMap((entry) => entry.registry?.kind === 'user-gpu-preferences'
    && fileKey(entry.registry.name) === fileKey(name) ? [{ ...entry.registry, undone: entry.undone }] : [])
  const owned = latestAutoHdrDisableIndex(transitions)
  if (owned === null) return false
  const { userSid, before, after } = transitions[owned]
  const current = await platform.readUserGpuPreferences(userSid, name)
  const restored = restoreAutoHdr(current, before, after)
  if (restored === current) return false
  await requireGameStopped(platform, observe)
  if (await platform.readUserGpuPreferences(userSid, name) !== current) throw new Error('Windows per-game graphics preferences changed while Lucent was restoring Auto HDR. Try again.')
  await platform.writeUserGpuPreferences(userSid, name, restored)
  if (await platform.readUserGpuPreferences(userSid, name) !== restored) throw new Error('Windows did not restore the per-game Auto HDR preference. Try again.')
  return true
}

/** Reads the frame-generation mode the owned configs hold, so an update carries it forward; null means the disk is Custom. */
async function frameGenerationModeOnDisk(platform: Platform, record: DeploymentRecord): Promise<FrameGenerationId | null> {
  const options = frameGenerationOptionsForGpu(record.recipe.frameGenerationOptions ?? [], record.graphics.name)
  if (!options.length) return null
  const declared = new Map<string, IniSetting>()
  for (const option of options) for (const setting of [...option.settings, ...(option.hdrSettings ?? [])]) {
    const id = `${fileKey(setting.file)}|${setting.section.toLowerCase()}|${setting.key.toLowerCase()}`
    if (!declared.has(id)) declared.set(id, setting)
  }
  const texts = new Map<string, string>()
  const root = joinPath(record.gameFolder, 'game')
  const onDisk: IniSetting[] = []
  for (const setting of declared.values()) {
    const file = Object.keys(record.ownedConfigs).find((path) => fileKey(path) === fileKey(setting.file))
    if (!file) continue
    let text = texts.get(fileKey(file))
    if (text === undefined) {
      try { text = await platform.readText(await platform.resolveGamePath(root, file)) }
      catch { continue }
      texts.set(fileKey(file), text)
    }
    const value = readIni(text).get(setting.section, setting.key)
    if (value !== undefined) onDisk.push({ ...setting, value })
  }
  return matchFrameGenerationMode(options, onDisk)
}

async function declaredSettingsOnDisk(platform: Platform, record: DeploymentRecord, settings: IniSetting[]): Promise<IniSetting[]> {
  const textByFile = new Map<string, ReturnType<typeof readIni> | null>()
  const values: IniSetting[] = []
  const root = joinPath(record.gameFolder, 'game')
  const seen = new Set<string>()
  for (const setting of settings) {
    const key = `${fileKey(setting.file)}|${setting.section.toLowerCase()}|${setting.key.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const file = Object.keys(record.ownedConfigs).find((path) => fileKey(path) === fileKey(setting.file))
    if (!file) continue
    let ini = textByFile.get(fileKey(file))
    if (ini === undefined) {
      try { ini = readIni(await platform.readText(await platform.resolveGamePath(root, file))) }
      catch { ini = null }
      textByFile.set(fileKey(file), ini)
    }
    if (!ini) continue
    const value = ini.get(setting.section, setting.key)
    if (value !== undefined) values.push({ ...setting, value })
  }
  return values
}

/** Reads the HDR mode from every declared owned config, so an update carries it forward; an unknown combination is Custom. */
async function hdrStateOnDisk(platform: Platform, record: DeploymentRecord): Promise<{ mode: HdrMode | null; active: boolean }> {
  const options = record.recipe.hdrOptions ?? []
  if (!options.length) return { mode: null, active: false }
  const settings = options.flatMap((option) => option.settings)
  const enabledSettings = settings.filter((setting) => setting.key.toLowerCase() === 'ffxivhdr')
  const onDisk = await declaredSettingsOnDisk(platform, record, settings)
  const valueId = (setting: IniSetting) => `${fileKey(setting.file)}|${setting.section.toLowerCase()}|${setting.key.toLowerCase()}`
  const values = new Map(onDisk.map((setting) => [valueId(setting), setting.value]))
  const valueFor = (file: string, section: string, key: string) => values.get(`${fileKey(file)}|${section.toLowerCase()}|${key.toLowerCase()}`)
  const mode = matchHdrMode(options, valueFor)
  const configured = enabledSettings.some((setting) => valueFor(setting.file, setting.section, setting.key)?.toLowerCase() === 'true')
  return { mode, active: mode === 'off' ? false : mode !== null || configured }
}

/**
 * Renames the recipe's entry files aside (Disabled) or back (Enabled) through the journal, so the game runs as if
 * vanilla while the deployment stays in place. The record's `enabled` and its file stamps follow the renames, so the
 * health check expects the new state and Repair, update and profile changes keep it. A failure or interruption
 * undoes only this toggle.
 */
export async function setDeploymentEnabled(platform: Platform, gameFolder: string, enabled: boolean): Promise<DeploymentRecord> {
  platform = await guardGameWrites(platform, gameFolder)
  const record = await readDeployment(platform, gameFolder)
  if (!record || record.status !== 'complete') throw new Error('Recover the deployment before changing whether Lucent is Enabled.')
  if (record.enabled === enabled) return record
  const paths = await dataPaths(platform, gameFolder)
  const renames = record.recipe.entryFiles.map((entry) => enabled
    ? { from: disabledName(entry.path), to: entry.path }
    : { from: entry.path, to: disabledName(entry.path) })
  const steps: PlanStep[] = renames.map((rename) => ({ kind: 'rename', ...rename }))
  // `record` journals the toggle while it applies; `changed` replaces it once every entry file has moved.
  const changed = structuredClone(record)
  record.status = 'applying'
  record.changeStart = record.journal.length
  record.createdDirectories ??= []
  record.changeDirectoryStart = record.createdDirectories.length
  const save = () => platform.writeText(paths.record, JSON.stringify(record, null, 2))
  await save()
  try {
    await applySteps({ platform, record, save, report: () => {}, owned: new Set(Object.keys(record.files).map(fileKey)) }, steps)
    for (const { from, to } of renames) {
      const deployedPath = Object.keys(changed.files).find((p) => fileKey(p) === fileKey(from))
      if (!deployedPath) throw new Error(`The deployment does not own its entry file: ${from}`)
      // A rename keeps the file's stamp, so the recorded stamp moves verbatim: a drifted entry stays drift.
      changed.files[to] = changed.files[deployedPath]
      delete changed.files[deployedPath]
    }
    changed.enabled = enabled
    changed.journal = record.journal
    changed.createdDirectories = record.createdDirectories
    await platform.writeText(paths.record, JSON.stringify(changed, null, 2))
    return changed
  } catch (error) {
    try { await undoDeployment(platform, record) } catch (recoveryError) {
      throw new DeploymentError(error, true, recoveryError)
    }
    throw new DeploymentError(error, false)
  }
}
