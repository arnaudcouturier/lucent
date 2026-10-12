import { assertGamePath, type ContentVersion, type Step, type Tier } from '../shared/manifest'
import { type ContentSource } from './manifest'
import { PlatformError, type FileStat, type GpuAdapter, type Platform } from './platform'
import { fileKey, planDeployment, type DeploymentScan, type Plan } from './planner'
import { joinPath, normalizePath } from './paths'

export interface FileStamp extends FileStat { sha256: string }
export interface JournalEntry {
  step: Step
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
  includeReShade: boolean
  enabled: boolean
  recipe: Plan['recipe']
  journal: JournalEntry[]
  ownedConfigs: Record<string, string>
  files: Record<string, FileStamp>
}
export type DeploymentPhase = 'downloading' | 'backing-up' | 'applying' | 'checking'
export interface DeploymentProgress { phase: DeploymentPhase; progress: number; file: string | null }

export async function dataPaths(platform: Platform, gameFolder: string) {
  const data = joinPath(await platform.envFolder('LocalAppData'), 'Lucent')
  const bytes = new TextEncoder().encode(normalizePath(gameFolder).toLowerCase())
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const id = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { data, cache: joinPath(data, 'cache'), backups: joinPath(data, 'backups'), record: joinPath(data, 'deployments', id, 'record.json') }
}

async function maybeStat(platform: Platform, path: string): Promise<FileStat | null> {
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
  if (value.schemaVersion !== 1 || !['applying', 'complete', 'rolled-back'].includes(value.status)
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
  return value
}

export async function scanDeployment(platform: Platform, gameFolder: string, content: ContentVersion, record: DeploymentRecord | null): Promise<DeploymentScan> {
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
  return { files, cachedFiles, ownedFiles: record?.status === 'complete' ? Object.keys(record.files) : [] }
}

export function releaseAsset(file: ContentVersion['files'][number]): string {
  return `https://github.com/arnaudcouturier/lucent/releases/download/${file.release}/${file.sha256}`
}

export async function undoDeployment(platform: Platform, record: DeploymentRecord): Promise<void> {
  if (await platform.isGameRunning()) throw new PlatformError('locked', 'Close XIV before recovering the unfinished deployment.')
  const paths = await dataPaths(platform, record.gameFolder)
  const root = joinPath(record.gameFolder, 'game')
  for (const entry of [...record.journal].reverse()) {
    if (entry.undone) continue
    for (const [relative, before] of Object.entries(entry.before).reverse()) {
      const target = await platform.resolveGamePath(root, relative)
      const stat = await maybeStat(platform, target)
      const current = stat ? await platform.hashFile(target) : null
      if (current === before) continue
      if (current !== entry.after[relative]) throw new Error(`Recovery stopped to protect a changed user file: ${relative}`)
      if (before === null) await platform.removeFile(target)
      else {
        const backup = joinPath(paths.backups, before)
        if (await platform.hashFile(backup) !== before) throw new PlatformError('hash-mismatch', `Backup hash mismatch: ${relative}`)
        await platform.copyFile(backup, target, current !== null)
      }
    }
    entry.undone = true
    await platform.writeText(paths.record, JSON.stringify(record, null, 2))
  }
  record.status = 'rolled-back'
  await platform.writeText(paths.record, JSON.stringify(record, null, 2))
}

/** Every asset is verified before a journal or game-folder mutation; each intent is durable before its step. */
export async function deployContent(
  platform: Platform, gameFolder: string, content: ContentVersion, tier: Tier, includeReShade: boolean,
  graphics: GpuAdapter, source: ContentSource, report: (progress: DeploymentProgress) => void,
): Promise<DeploymentRecord> {
  if (await platform.isGameRunning()) throw new PlatformError('locked', 'Close XIV before installing.')
  const previous = await readDeployment(platform, gameFolder)
  if (previous && previous.status !== 'rolled-back') throw new Error('This game folder already has a deployment. Reopen Lucent to inspect it.')
  const scan = await scanDeployment(platform, gameFolder, content, null)
  const plan = planDeployment(content, tier, includeReShade, scan)
  if (plan.blockedPaths.length) throw new Error(`These user files would be replaced: ${plan.blockedPaths.join(', ')}. Move them aside before installing.`)
  const paths = await dataPaths(platform, gameFolder)
  const root = joinPath(gameFolder, 'game')
  for (let i = 0; i < plan.files.length; i++) {
    const file = plan.files[i]
    const path = joinPath(paths.cache, file.sha256)
    report({ phase: 'downloading', progress: i / plan.files.length * 0.4, file: null })
    if (!scan.cachedFiles.includes(file.sha256)) {
      if (source.kind === 'local') await platform.copyFile(joinPath(source.filesDirectory, file.sha256), path)
      else await platform.downloadFile(releaseAsset(file), path, (received) => report({ phase: 'downloading', progress: (i + Math.min(1, received / Math.max(1, file.size))) / plan.files.length * 0.4, file: null }))
    }
    if ((await platform.stat(path)).size !== file.size || await platform.hashFile(path) !== file.sha256) {
      await platform.removeFile(path)
      throw new PlatformError('hash-mismatch', 'A downloaded file failed its hash check. The game folder has not been changed.', path)
    }
  }
  if (await platform.isGameRunning()) throw new PlatformError('locked', 'Close XIV before installing.')
  const record: DeploymentRecord = {
    schemaVersion: 1, status: 'applying', gameFolder, tier: tier.id, graphics, contentVersion: content.id,
    includeReShade: plan.includeReShade, enabled: true, recipe: plan.recipe, journal: [], ownedConfigs: {}, files: {},
  }
  const save = () => platform.writeText(paths.record, JSON.stringify(record, null, 2))
  const owned = new Set<string>()
  await save()
  try {
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]
      const relatives = step.kind === 'copy' ? [step.to] : step.kind === 'rename' ? [step.from, step.to] : [step.path]
      const before: JournalEntry['before'] = Object.create(null)
      report({ phase: 'backing-up', progress: 0.4 + i / plan.steps.length * 0.4, file: relatives[0] })
      for (const relative of relatives) {
        assertGamePath(relative)
        const path = await platform.resolveGamePath(root, relative)
        const stat = await maybeStat(platform, path)
        if (stat && (!owned.has(fileKey(relative)) || stat.kind !== 'file')) throw new Error(`Protecting a user file: ${relative}. The folder changed since Review.`)
        before[relative] = stat ? await platform.hashFile(path) : null
        if (before[relative]) {
          const backup = joinPath(paths.backups, before[relative]!)
          await platform.copyFile(path, backup)
          if (await platform.hashFile(backup) !== before[relative]) throw new PlatformError('hash-mismatch', `Backup hash mismatch: ${relative}`)
        }
      }
      const after: JournalEntry['after'] = step.kind === 'copy' ? { [step.to]: step.file }
        : step.kind === 'rename' ? { [step.from]: null, [step.to]: before[step.from] } : { [step.path]: null }
      if (step.kind === 'rename' && !before[step.from]) throw new Error(`Rename source is missing: ${step.from}`)
      record.journal.push({ step, before, after })
      await save()
      report({ phase: 'applying', progress: 0.4 + (i + 0.5) / plan.steps.length * 0.4, file: relatives[0] })
      if (await platform.isGameRunning()) throw new PlatformError('locked', 'XIV started during installation. Close it before retrying.')
      // Resolve again after the durable journal write, immediately before the mutation.
      if (step.kind === 'copy') await platform.copyFile(joinPath(paths.cache, step.file), await platform.resolveGamePath(root, step.to), before[step.to] !== null)
      else if (step.kind === 'rename') await platform.renameFile(await platform.resolveGamePath(root, step.from), await platform.resolveGamePath(root, step.to), before[step.to] !== null)
      else await platform.removeFile(await platform.resolveGamePath(root, step.path))
      for (const relative of relatives) owned.add(fileKey(relative))
    }
    for (let i = 0; i < plan.expectedFiles.length; i++) {
      const file = plan.expectedFiles[i]
      report({ phase: 'checking', progress: 0.8 + i / plan.expectedFiles.length * 0.2, file: file.path })
      const path = await platform.resolveGamePath(root, file.path)
      const stamp = { ...await platform.stat(path), sha256: await platform.hashFile(path) }
      if (stamp.sha256 !== file.sha256) throw new PlatformError('hash-mismatch', `The deployed file failed its hash check: ${file.path}`)
      record.files[file.path] = stamp
    }
    for (const config of plan.recipe.ownedConfigs) record.ownedConfigs[config.path] = await platform.readText(await platform.resolveGamePath(root, config.path))
    record.status = 'complete'
    await save()
    report({ phase: 'checking', progress: 1, file: null })
    return record
  } catch (error) {
    record.status = 'applying'
    try { await undoDeployment(platform, record) } catch (recoveryError) {
      throw new Error(`${error instanceof Error ? error.message : error} Recovery needs attention: ${recoveryError instanceof Error ? recoveryError.message : recoveryError}`)
    }
    throw error
  }
}
