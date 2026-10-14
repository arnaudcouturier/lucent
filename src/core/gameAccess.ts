import { PlatformError, type Platform } from './platform'
import { joinPath, normalizePath } from './paths'
import { assertGamePath, FRAME_GENERATION_IDS, HDR_MODES, NR_PASSES, NR_PRESET_IDS, NR_SCALES, PROFILE_IDS, type FrameGenerationId, type HdrMode, type NeuralRenderingChoice, type ProfileId } from '../shared/manifest'
import type { State } from './core'

/** UI availability only; every command still checks the machine immediately before writing. */
export const gameActionsAvailable = (state: Pick<State, 'busy' | 'recoveryRequired' | 'gameRunning' | 'gameFolder'>) =>
  !state.busy && !state.recoveryRequired && state.gameRunning === false && state.gameFolder.status !== 'missing'

export async function requireGameStopped(platform: Platform, observe?: (running: boolean) => void): Promise<void> {
  const running = await platform.isGameRunning()
  observe?.(running)
  if (running) throw new PlatformError('locked', 'Close XIV before changing the game folder. Changes wait until the game closes.')
}

/** Protects every mutation, including recovery. Future recipes inherit the same boundary. */
export async function guardGameWrites(platform: Platform, gameFolder: string): Promise<Platform> {
  await requireGameStopped(platform)
  const root = normalizePath(joinPath(gameFolder, 'game')).toLowerCase()
  const check = async (...paths: string[]) => {
    if (paths.some((path) => {
      const normalized = normalizePath(path).toLowerCase()
      return normalized === root || normalized.startsWith(root + '\\')
    })) await requireGameStopped(platform)
  }
  return {
    ...platform,
    async writeText(path, text, staging) { await check(path); await platform.writeText(path, text, staging) },
    async writeFileByte(path, offset, value) { await check(path); await platform.writeFileByte(path, offset, value) },
    async copyFile(from, to, replace, staging) { await check(to); await platform.copyFile(from, to, replace, staging) },
    async renameFile(from, to, replace) { await check(from, to); await platform.renameFile(from, to, replace) },
    async removeFile(path) { await check(path); await platform.removeFile(path) },
    async removeDirectoryIfEmpty(path) { await check(path); await platform.removeDirectoryIfEmpty(path) },
    // A batch checks once: a process scan costs about 6 ms, more than a hundred small file writes.
    async copyMany(items, staging) { await check(...items.map((item) => item.to)); await platform.copyMany(items, staging) },
    async removeMany(paths) { await check(...paths); await platform.removeMany(paths) },
    async writeFileBytes(path, offsets, value) { await check(path); await platform.writeFileBytes(path, offsets, value) },
    async removeDirectoriesIfEmpty(paths) { await check(...paths); await platform.removeDirectoriesIfEmpty(paths) },
    async downloadFile(url, to, progress) { await check(to); await platform.downloadFile(url, to, progress) },
    async isDirectoryWritable(path, targets) { await check(path); return platform.isDirectoryWritable(path, targets) },
  }
}

export type GameWriteRequest = { gameFolder: string } & (
  | { kind: 'deploy'; contentVersion: string; includeReShade: boolean; profile: ProfileId | null; frameGenerationMode: FrameGenerationId | null; hdrMode: HdrMode | null; neuralRendering?: NeuralRenderingChoice | null; mfgUnlocked?: boolean; reviewedPaths: string[] }
  | { kind: 'reset'; contentVersion: string; tier: string; includeReShade: boolean; profile: ProfileId | null; frameGenerationMode: FrameGenerationId | null; hdrMode: HdrMode | null; neuralRendering?: NeuralRenderingChoice | null; mfgUnlocked?: boolean; reviewedPaths: string[]; backupPath: string }
  | { kind: 'repair' | 'uninstall' | 'recover' }
  | { kind: 'update'; contentVersion: string }
  | { kind: 'tier'; tier: string; contentVersion: string }
  | { kind: 'enabled'; enabled: boolean }
)

const validNeuralRendering = (value: NeuralRenderingChoice) => !!value && typeof value === 'object'
  && (NR_PRESET_IDS as readonly string[]).includes(value.preset) && (NR_PASSES as readonly number[]).includes(value.passes) && (NR_SCALES as readonly number[]).includes(value.scale)
  && typeof value.spatialCompression === 'boolean' && typeof value.residualFg === 'boolean'

const resumeDirectory = async (platform: Platform) => joinPath(await platform.envFolder('LocalAppData'), 'Lucent')

/** The player's data context, available before acquiring its operation lock or consuming the resume request. */
export function elevationResumeLocalAppData(path: string): string {
  const normalized = normalizePath(path)
  const match = /^(.*)\\Lucent\\resume-[a-f0-9-]{36}\.json$/i.exec(normalized)
  if (!match || !/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+\\)/i.test(normalized) || normalized.split('\\').includes('..')) throw new Error('The administrator resume file is invalid.')
  return match[1]
}

/** The request is consumed before executing it, so failures never retry silently on another launch. */
export async function takeElevationResume(platform: Platform): Promise<{ localAppData: string; userSid: string | null; request: GameWriteRequest | null } | null> {
  const path = await platform.getElevationResumePath()
  if (!path) return null
  // UAC may use another administrator account. The original path carries the player's data context,
  // even after the request has been consumed or this elevated process is relaunched by an app update.
  const localAppData = elevationResumeLocalAppData(path)
  if (!await platform.isElevated()) throw new Error('Administrator access was not granted. Try the change again.')
  let text: string
  try { text = await platform.readText(path) }
  catch (error) { if (error instanceof PlatformError && error.kind === 'not-found') return { localAppData, userSid: null, request: null }; throw error }
  await platform.removeFile(path)
  const value = JSON.parse(text) as { schemaVersion?: unknown; userSid?: unknown; request?: GameWriteRequest }
  const request = value?.request
  const hasSid = typeof value?.userSid === 'string' && /^S-1-\d+(?:-\d+)+$/.test(value.userSid)
  if ((value?.schemaVersion !== 1 && value?.schemaVersion !== 2) || (value.schemaVersion === 2 && !hasSid) || !request || typeof request.gameFolder !== 'string'
    || !['deploy', 'reset', 'repair', 'uninstall', 'recover', 'update', 'tier', 'enabled'].includes(request.kind)
    || ((request.kind === 'deploy' || request.kind === 'reset' || request.kind === 'update' || request.kind === 'tier') && typeof request.contentVersion !== 'string')
    || ((request.kind === 'reset' || request.kind === 'tier') && typeof request.tier !== 'string')
    || ((request.kind === 'deploy' || request.kind === 'reset') && (typeof request.includeReShade !== 'boolean' || (request.profile !== null && !(PROFILE_IDS as readonly string[]).includes(request.profile))
      || (request.frameGenerationMode !== null && !(FRAME_GENERATION_IDS as readonly string[]).includes(request.frameGenerationMode as string))
      || (request.hdrMode !== null && !(HDR_MODES as readonly string[]).includes(request.hdrMode as string))
      || (request.mfgUnlocked !== undefined && typeof request.mfgUnlocked !== 'boolean')
      || (request.neuralRendering !== undefined && request.neuralRendering !== null && !validNeuralRendering(request.neuralRendering))))
    || (request.kind === 'enabled' && typeof request.enabled !== 'boolean')) throw new Error('The administrator resume request is invalid.')
  if (request.kind === 'deploy' || request.kind === 'reset') {
    if (!Array.isArray(request.reviewedPaths) || request.reviewedPaths.some((path) => typeof path !== 'string')) throw new Error('The administrator resume request is invalid.')
    request.reviewedPaths.forEach(assertGamePath)
    if (request.kind === 'reset') {
      const backupRoot = normalizePath(joinPath(localAppData, 'Lucent', 'Backups')).toLowerCase()
      const backup = normalizePath(request.backupPath).toLowerCase()
      if (!request.backupPath.length || request.backupPath.includes('..') || (backup !== backupRoot && !backup.startsWith(`${backupRoot}\\`))) throw new Error('The administrator resume request is invalid.')
    }
  }
  return { localAppData, userSid: hasSid ? value.userSid as string : null, request }
}

/** UAC only after a denied game-folder probe; a cancelled prompt doesn't count, so the player can retry. */
export function gameWriteAccess(platform: Platform, observe: (running: boolean) => void) {
  let requested = false
  return async (request: GameWriteRequest, targets: string[]): Promise<boolean> => {
    await requireGameStopped(platform, observe)
    if (await platform.isDirectoryWritable(joinPath(request.gameFolder, 'game'), targets)) return true
    if (await platform.isElevated()) throw new Error('The game folder is still not writable with administrator access. Check its permissions, then try again.')
    if (requested) throw new Error('Administrator access was already requested. Reopen Lucent to try again.')
    const path = joinPath(await resumeDirectory(platform), `resume-${crypto.randomUUID()}.json`)
    const userSid = await platform.currentUserSid()
    if (!/^S-1-\d+(?:-\d+)+$/.test(userSid)) throw new Error('The player account SID is invalid; Lucent could not prepare an administrator relaunch.')
    await platform.writeText(path, JSON.stringify({ schemaVersion: 2, userSid, request }))
    requested = true
    try { await platform.requestElevation(path) }
    catch (error) { requested = false; await platform.removeFile(path); throw error }
    return false
  }
}
