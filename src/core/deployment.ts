import { assertGamePath, validateManifest, type ContentVersion, type ExistingSetupSignature, type ProfileId, type Tier } from '../shared/manifest'
import { type ContentSource } from './manifest'
import { PlatformError, type FileStat, type GpuAdapter, type Platform } from './platform'
import { disabledName, fileKey, planDeployment, stepWritePaths, type DeploymentScan, type Plan, type PlanStep } from './planner'
import { detectExistingSetups } from './existingSetup'
import { joinPath, normalizePath, parentPath } from './paths'
import { mergeIni, readIni } from './ini'
import { cacheSnapshot, type CachedVersion } from './versions'
import { guardGameWrites, requireGameStopped } from './gameAccess'

export interface FileStamp extends FileStat { sha256: string }
export interface JournalEntry {
  step: PlanStep
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
}
export type DeploymentPhase = 'downloading' | 'backing-up' | 'applying' | 'checking'
export interface DeploymentProgress { phase: DeploymentPhase; progress: number; file: string | null }

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
  constructor(error: unknown, readonly recoveryRequired: boolean, recoveryError?: unknown) {
    const reason = failureReason(error)
    // XIV starting mid-install blocks both the step and its undo; say so once.
    const recovery = failureReason(recoveryError) === reason ? '' : ` ${failureReason(recoveryError)}`
    super(`${reason} ${recoveryRequired
      ? `Recovery could not finish.${recovery} Keep Lucent’s journal and backups; try recovery again once the problem is resolved.`
      : 'Lucent restored the game folder to how it was before.'}`)
    this.name = 'DeploymentError'
  }
}

async function hashText(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function dataPaths(platform: Platform, gameFolder: string) {
  const data = joinPath(await platform.envFolder('LocalAppData'), 'Lucent')
  const id = await hashText(normalizePath(gameFolder).toLowerCase())
  return { data, cache: joinPath(data, 'cache'), backups: joinPath(data, 'backups'), record: joinPath(data, 'deployments', id, 'record.json') }
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
    if (!entry.before || !entry.after || (entry.undone !== undefined && typeof entry.undone !== 'boolean')) throw new Error('The deployment journal is damaged.')
    for (const [path, hash] of [...Object.entries(entry.before), ...Object.entries(entry.after)]) {
      assertGamePath(path)
      if (hash !== null && !/^[a-f0-9]{64}$/.test(hash)) throw new Error('The deployment backup hash is invalid.')
    }
  }
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
  const directory = joinPath(await platform.envFolder('LocalAppData'), 'Lucent', 'deployments')
  if (!await maybeStat(platform, directory)) return []
  const recovered: DeploymentRecord[] = []
  for (const relative of (await platform.listFiles(directory)).sort()) {
    if (!relative.endsWith('record.json')) continue
    const path = joinPath(directory, relative)
    const value = JSON.parse(await platform.readText(path)) as Partial<DeploymentRecord> | null
    if (!value || typeof value.gameFolder !== 'string'
      || fileKey(path) !== fileKey((await dataPaths(platform, value.gameFolder)).record)) {
      throw new Error('The deployment record is damaged. Keep it and its backups for recovery.')
    }
    const record = await readDeployment(platform, value.gameFolder)
    if (record?.status === 'applying') {
      await beforeRecovery?.(record)
      await undoDeployment(platform, record)
      recovered.push(record)
    }
  }
  return recovered
}

export async function scanDeployment(platform: Platform, gameFolder: string, content: ContentVersion, record: DeploymentRecord | null, signatures: ExistingSetupSignature[]): Promise<DeploymentScan> {
  const root = joinPath(gameFolder, 'game')
  const files: DeploymentScan['files'] = Object.create(null)
  for (const relative of await platform.listFiles(root)) {
    const path = await platform.resolveGamePath(root, relative)
    files[relative] = await platform.stat(path)
  }
  const { cache } = await dataPaths(platform, gameFolder)
  const cachedFiles: string[] = []
  for (const file of content.files) {
    const path = joinPath(cache, file.sha256)
    const stat = await maybeStat(platform, path)
    if (stat?.kind === 'file' && stat.size === file.size && await platform.hashFile(path) === file.sha256) cachedFiles.push(file.sha256)
  }
  const ownedFiles = record?.status === 'complete' ? Object.keys(record.files) : []
  return { files, cachedFiles, ownedFiles, existingSetups: detectExistingSetups(signatures, Object.keys(files), ownedFiles) }
}

export function releaseAsset(file: ContentVersion['files'][number]): string {
  return `https://github.com/arnaudcouturier/lucent/releases/download/${file.release}/${file.sha256}`
}

async function undoDirectories(platform: Platform, gameFolder: string, created: string[]) {
  const root = joinPath(gameFolder, 'game')
  const directories = [...created].sort((a, b) => b.split('/').length - a.split('/').length)
  for (const relative of directories) await platform.removeDirectoryIfEmpty(await platform.resolveGamePath(root, relative))
}

export async function undoDeployment(platform: Platform, record: DeploymentRecord): Promise<void> {
  platform = await guardGameWrites(platform, record.gameFolder)
  const paths = await dataPaths(platform, record.gameFolder)
  const root = joinPath(record.gameFolder, 'game')
  const start = record.changeStart ?? 0
  // Flipping a preallocated byte needs no free space, so a full data disk cannot stop the undo.
  const checkpoint = (entry: number | 'all') => record.undoCheckpoints && start === 0
    ? platform.writeFileByte(checkpointsPath(paths.record, record.undoCheckpoints.id), entry === 'all' ? record.undoCheckpoints.size - 1 : entry, UNDONE)
    : platform.writeText(paths.record, JSON.stringify(record, null, 2))
  if (record.uninstalling) {
    for (const path of record.generatedFiles ?? []) {
      const target = await platform.resolveGamePath(root, path)
      if ((await maybeStat(platform, target))?.kind === 'file') await platform.removeFile(target)
    }
  }
  for (let i = record.journal.length - 1; i >= start; i--) {
    const entry = record.journal[i]
    if (entry.undone) continue
    // A carried-over preset is a user file once the deployment is complete; only a failed deployment takes it back.
    const keep = record.uninstalling && entry.step.kind === 'carry'
    for (const [relative, before] of keep ? [] : Object.entries(entry.before).reverse()) {
      const target = await platform.resolveGamePath(root, relative)
      const stat = await maybeStat(platform, target)
      const current = stat ? await platform.hashFile(target) : null
      if (current === before) continue
      if (current !== entry.after[relative]) {
        if (!record.uninstalling) throw new Error(`Recovery stopped to protect a changed user file: ${relative}`)
        // A file Lucent added stays Lucent's even after a mod rewrites it; a replaced original is newer than the deployment.
        if (before !== null && current !== null) continue
      }
      if (before === null) await platform.removeFile(target)
      else {
        const backup = joinPath(paths.backups, before)
        if (await platform.hashFile(backup) !== before) throw new PlatformError('hash-mismatch', `Backup hash mismatch: ${relative}`)
        await platform.copyFile(backup, target, current !== null, parentPath(record.gameFolder))
      }
    }
    entry.undone = true
    await checkpoint(i)
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
}

/** Every asset is verified before a journal or game-folder mutation; each intent is durable before its step. */
export async function deployContent(
  platform: Platform, gameFolder: string, content: ContentVersion, signatures: ExistingSetupSignature[], tier: Tier, includeReShade: boolean, profile: ProfileId | null,
  graphics: GpuAdapter, source: ContentSource, report: (progress: DeploymentProgress) => void,
): Promise<DeploymentRecord> {
  platform = await guardGameWrites(platform, gameFolder)
  const previous = await readDeployment(platform, gameFolder)
  if (previous && previous.status !== 'rolled-back') throw new Error('This game folder already has a deployment. Reopen Lucent to inspect it.')
  const scan = await scanDeployment(platform, gameFolder, content, null, signatures)
  const plan = planDeployment(content, tier, includeReShade, scan, profile)
  if (plan.blockedPaths.length) throw new Error(`These user files would be replaced: ${plan.blockedPaths.join(', ')}. Move them aside before installing.`)
  const paths = await dataPaths(platform, gameFolder)
  const present = new Set(Object.keys(scan.files).map(fileKey))
  // An existing setup's log is backed up like its other files, so the one the mods write later is Lucent's to remove.
  const takenOver = new Set(plan.takenOver.map(fileKey))
  await cachePlannedFiles(platform, paths.cache, plan, scan.cachedFiles, source, report)
  await requireGameStopped(platform)
  const record: DeploymentRecord = {
    schemaVersion: 1, status: 'applying', gameFolder, tier: tier.id, graphics, contentVersion: content.id,
    includeReShade: plan.includeReShade, enabled: true, profile: plan.profile, recipe: plan.recipe, journal: [], createdDirectories: [],
    cachedVersions: [cacheSnapshot(content, tier, plan.recipe, plan.files)],
    generatedFiles: plan.recipe.generatedFiles.map((p) => p.path).filter((p) => !present.has(fileKey(p)) || takenOver.has(fileKey(p))), undoCheckpoints: { id: crypto.randomUUID(), size: plan.steps.length + 1 }, ownedConfigs: {}, files: {},
  }
  const save = () => platform.writeText(paths.record, JSON.stringify(record, null, 2))
  // Reserve every undo checkpoint before the first game write. Updating one byte
  // needs no new file allocation even if a later journal write fills Lucent's disk.
  await platform.writeText(checkpointsPath(paths.record, record.undoCheckpoints!.id), '0'.repeat(record.undoCheckpoints!.size))
  await save()
  await discardCheckpoints(platform, paths.record, previous?.undoCheckpoints)
  try {
    // An existing setup's files are the only files Lucent takes over without having written them.
    await applySteps({ platform, record, save, report, owned: takenOver }, plan.steps)
    record.files = await stampFiles(platform, record, plan.expectedFiles, report)
    record.ownedConfigs = await readOwnedConfigs(platform, gameFolder, plan)
    // The checkpoints cover only this deployment's own steps; later journal entries are undone through the record.
    const complete: DeploymentRecord = { ...record, status: 'complete', undoCheckpoints: undefined }
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

/** Downloads every planned file the cache lacks, verifying each, before the game folder changes. */
async function cachePlannedFiles(platform: Platform, cache: string, plan: Plan, cachedFiles: string[], source: ContentSource, report: (progress: DeploymentProgress) => void) {
  for (let i = 0; i < plan.files.length; i++) {
    const file = plan.files[i]
    const path = joinPath(cache, file.sha256)
    report({ phase: 'downloading', progress: i / plan.files.length * 0.4, file: null })
    if (!cachedFiles.includes(file.sha256)) await cacheFile(platform, cache, file, source, (received) => report({ phase: 'downloading', progress: (i + Math.min(1, received / Math.max(1, file.size))) / plan.files.length * 0.4, file: null }))
    else if ((await platform.stat(path)).size !== file.size || await platform.hashFile(path) !== file.sha256) {
      await platform.removeFile(path)
      throw new PlatformError('hash-mismatch', 'A downloaded file failed its hash check. The game folder has not been changed.', path)
    }
  }
}

interface Execution {
  platform: Platform
  /** Journals each step, with its backup, before the step takes effect. */
  record: DeploymentRecord
  save: () => Promise<void>
  report: (progress: DeploymentProgress) => void
  /** Game-folder paths Lucent may overwrite or remove; every other existing file is the player's. */
  owned: Set<string>
  /** Names the command in the message when XIV starts partway. */
}

/** Applies planned steps through the journal: each intent and its verified backup are durable before the step. */
async function applySteps({ platform, record, save, report, owned }: Execution, steps: PlanStep[]) {
  const { gameFolder } = record
  const { backups, cache } = await dataPaths(platform, gameFolder)
  const root = joinPath(gameFolder, 'game')
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const relatives = stepWritePaths(step)
    const before: JournalEntry['before'] = Object.create(null)
    report({ phase: 'backing-up', progress: 0.4 + i / steps.length * 0.4, file: relatives[0] })
    for (const relative of relatives) {
      assertGamePath(relative)
      const parts = relative.replace(/\\/g, '/').split('/')
      for (let length = 1; length < parts.length; length++) {
        const directory = parts.slice(0, length).join('/')
        if (!record.createdDirectories!.some((p) => fileKey(p) === fileKey(directory))
          && !await maybeStat(platform, await platform.resolveGamePath(root, directory))) record.createdDirectories!.push(directory)
      }
      const path = await platform.resolveGamePath(root, relative)
      const stat = await maybeStat(platform, path)
      if (stat && (!owned.has(fileKey(relative)) || stat.kind !== 'file')) throw new Error(`Protecting a user file: ${relative}. The folder changed since Review.`)
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
    report({ phase: 'applying', progress: 0.4 + (i + 0.5) / steps.length * 0.4, file: relatives[0] })
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
}

/** Checks every file the plan expects against the hash the journal last wrote there, and stamps it. */
async function stampFiles(platform: Platform, record: DeploymentRecord, expectedFiles: Plan['expectedFiles'], report: (progress: DeploymentProgress) => void) {
  const root = joinPath(record.gameFolder, 'game')
  const files: Record<string, FileStamp> = {}
  for (let i = 0; i < expectedFiles.length; i++) {
    const file = expectedFiles[i]
    report({ phase: 'checking', progress: 0.8 + i / expectedFiles.length * 0.2, file: file.path })
    const path = await platform.resolveGamePath(root, file.path)
    const stamp = { ...await platform.stat(path), sha256: await platform.hashFile(path) }
    const lastWrite = [...record.journal].reverse().flatMap((entry) => Object.entries(entry.after)).find(([p]) => fileKey(p) === fileKey(file.path))
    const expected = file.sha256 ?? lastWrite?.[1]
    if (stamp.sha256 !== expected) throw new PlatformError('hash-mismatch', `The deployed file failed its hash check: ${file.path}`)
    files[file.path] = stamp
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
 * performance profile, are kept. A failure or interruption undoes only the update.
 */
export async function updateDeployment(
  platform: Platform, gameFolder: string, content: ContentVersion, tier: Tier, source: ContentSource, report: (progress: DeploymentProgress) => void,
): Promise<DeploymentRecord> {
  platform = await guardGameWrites(platform, gameFolder)
  const record = await readDeployment(platform, gameFolder)
  if (!record || record.status !== 'complete') throw new Error('Recover the deployment before updating it.')
  // No existing-setup signatures: without a Review to explain a takeover, a setup that appeared since blocks the update instead.
  const scan = await scanDeployment(platform, gameFolder, content, record, [])
  const plan = planDeployment(content, tier, record.includeReShade, scan, record.profile ?? null, record.enabled)
  if (plan.blockedPaths.length) throw new Error(`These user files would be replaced: ${plan.blockedPaths.join(', ')}. Move them aside before updating.`)
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
      mergedTexts.set(key, mergeIni(record.ownedConfigs[basePath], diskText, incomingText, resetKeys.filter((k) => fileKey(k.file) === key)))
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
    const taken = new Set([...Object.keys(scan.files).map(fileKey), ...plan.expectedFiles.map((f) => fileKey(f.path))])
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
    const present = new Set(Object.keys(scan.files).map(fileKey))
    Object.assign(updated, {
      contentVersion: content.id, includeReShade: plan.includeReShade, profile: plan.profile, recipe: plan.recipe,
      cachedVersions: [cacheSnapshot(content, tier, plan.recipe, plan.files), ...(record.cachedVersions ?? []).filter((v) => v.content.id !== content.id)].slice(0, 3),
      pinned: content.id < record.contentVersion,
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

/** Downloads a content asset into the cache (or copies it from local dev content) and verifies it. */
async function cacheFile(platform: Platform, cache: string, file: ContentVersion['files'][number], source: ContentSource, progress: (received: number) => void) {
  const path = joinPath(cache, file.sha256)
  if (source.kind === 'local') await platform.copyFile(joinPath(source.filesDirectory, file.sha256), path)
  else await platform.downloadFile(releaseAsset(file), path, progress)
  if ((await platform.stat(path)).size !== file.size || await platform.hashFile(path) !== file.sha256) {
    await platform.removeFile(path)
    throw new PlatformError('hash-mismatch', 'A downloaded file failed its hash check. The game folder has not been changed.', path)
  }
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
  for (let i = 0; i < assets.length; i++) {
    report({ phase: 'downloading', progress: i / assets.length * 0.4, file: null })
    const cached = joinPath(paths.cache, assets[i])
    if ((await maybeStat(platform, cached))?.kind === 'file' && await platform.hashFile(cached) === assets[i]) continue
    const file = content?.files.find((f) => f.sha256 === assets[i])
    if (!file || !source) throw new PlatformError('network', 'Lucent couldn’t download a content file for the repair.')
    await cacheFile(platform, paths.cache, file, source, (received) => report({ phase: 'downloading', progress: (i + Math.min(1, received / Math.max(1, file.size))) / assets.length * 0.4, file: null }))
  }
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
      report({ phase: 'applying', progress: 0.4 + i / targets.length * 0.5, file: relative })
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

/** Uses the deployed recipe, so a newer manifest cannot change an older deployment's profiles. */
export async function changePerformanceProfile(platform: Platform, gameFolder: string, profileId: ProfileId): Promise<DeploymentRecord> {
  platform = await guardGameWrites(platform, gameFolder)
  const record = await readDeployment(platform, gameFolder)
  if (!record || record.status !== 'complete') throw new Error('Recover the deployment before changing its performance profile.')
  const profile = record.recipe.performanceProfiles?.find((p) => p.id === profileId)
  if (!profile) throw new Error('This performance profile is unavailable for the deployed tier.')
  const paths = await dataPaths(platform, gameFolder)
  const root = joinPath(gameFolder, 'game')
  // `record` journals the change while it applies; `changed` replaces it once every setting is written.
  const changed = structuredClone(record)
  record.status = 'applying'
  record.changeStart = record.journal.length
  const save = () => platform.writeText(paths.record, JSON.stringify(record, null, 2))
  await save()
  try {
    for (const setting of profile.settings) {
      // The deployed recipe's profiles only contain settings for configs it deployed.
      const config = Object.keys(record.ownedConfigs).find((p) => fileKey(p) === fileKey(setting.file))
      const stamped = Object.keys(record.files).find((p) => fileKey(p) === fileKey(setting.file))
      if (!config || !stamped) throw new Error(`Profile config is missing from the deployment: ${setting.file}`)
      const target = await platform.resolveGamePath(root, config)
      const text = await platform.readText(target)
      const before = await platform.hashFile(target)
      if (before !== await hashText(text)) throw new Error(`The config changed while it was being read: ${config}. Try again.`)
      const edited = readIni(text)
      edited.set(setting.section, setting.key, setting.value)
      const afterText = edited.toString()
      const after = await hashText(afterText)
      const lastWritten = readIni(changed.ownedConfigs[config])
      lastWritten.set(setting.section, setting.key, setting.value)
      changed.ownedConfigs[config] = lastWritten.toString()
      if (after !== before) {
        const backup = joinPath(paths.backups, before)
        await platform.copyFile(target, backup)
        if (await platform.hashFile(backup) !== before) throw new PlatformError('hash-mismatch', `Backup hash mismatch: ${config}`)
        record.journal.push({ step: { kind: 'ini_set', ...setting, file: config }, before: { [config]: before }, after: { [config]: after } })
        await save()
        await requireGameStopped(platform)
        if (await platform.hashFile(await platform.resolveGamePath(root, config)) !== before) throw new Error(`The config changed during the profile change: ${config}. Try again.`)
        await platform.writeText(await platform.resolveGamePath(root, config), afterText, parentPath(gameFolder))
      }
      if (await platform.hashFile(await platform.resolveGamePath(root, config)) !== after) throw new PlatformError('hash-mismatch', `Profile config hash mismatch: ${config}`)
      // Only a config matching Lucent's last-written copy is stamped again, so its stamp stays what Lucent wrote.
      if (after === await hashText(changed.ownedConfigs[config])) changed.files[stamped] = { ...await platform.stat(target), sha256: after }
    }
    changed.profile = profile.id
    changed.journal = record.journal
    await platform.writeText(paths.record, JSON.stringify(changed, null, 2))
    return changed
  } catch (error) {
    try { await undoDeployment(platform, record) } catch (recoveryError) {
      throw new DeploymentError(error, true, recoveryError)
    }
    throw error
  }
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
