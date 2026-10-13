import { PlatformError, type Platform } from './platform'
import { joinPath, normalizePath } from './paths'
import type { ProfileId } from '../shared/manifest'
import type { State } from './core'

/** UI availability only; every command still checks the machine immediately before writing. */
export const gameActionsAvailable = (state: Pick<State, 'busy' | 'recoveryRequired' | 'gameRunning'>) =>
  !state.busy && !state.recoveryRequired && state.gameRunning === false

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
    async downloadFile(url, to, progress) { await check(to); await platform.downloadFile(url, to, progress) },
    async isDirectoryWritable(path, targets) { await check(path); return platform.isDirectoryWritable(path, targets) },
  }
}

export type GameWriteRequest = { gameFolder: string } & (
  | { kind: 'deploy'; contentVersion: string; includeReShade: boolean; profile: ProfileId | null }
  | { kind: 'repair' | 'uninstall' | 'recover' }
  | { kind: 'update'; contentVersion: string }
  | { kind: 'profile'; profile: ProfileId }
  | { kind: 'enabled'; enabled: boolean }
)

const resumeDirectory = async (platform: Platform) => joinPath(await platform.envFolder('LocalAppData'), 'Lucent')

/** The request is consumed before executing it, so failures never retry silently on another launch. */
export async function takeElevationResume(platform: Platform): Promise<{ localAppData: string; request: GameWriteRequest | null } | null> {
  const path = await platform.getElevationResumePath()
  if (!path) return null
  // UAC may use another administrator account. The original path carries the player's data context,
  // even after the request has been consumed or this elevated process is relaunched by an app update.
  const normalized = normalizePath(path)
  const match = /^(.*)\\Lucent\\resume-[a-f0-9-]{36}\.json$/i.exec(normalized)
  if (!match || !/^(?:[a-z]:\\|\\\\[^\\]+\\[^\\]+\\)/i.test(normalized) || normalized.split('\\').includes('..')) throw new Error('The administrator resume file is invalid.')
  const localAppData = match[1]
  if (!await platform.isElevated()) throw new Error('Administrator access was not granted. Try the change again.')
  let text: string
  try { text = await platform.readText(path) }
  catch (error) { if (error instanceof PlatformError && error.kind === 'not-found') return { localAppData, request: null }; throw error }
  await platform.removeFile(path)
  const value = JSON.parse(text) as { schemaVersion?: unknown; request?: GameWriteRequest }
  const request = value?.request
  if (value?.schemaVersion !== 1 || !request || typeof request.gameFolder !== 'string'
    || !['deploy', 'repair', 'uninstall', 'recover', 'update', 'profile', 'enabled'].includes(request.kind)
    || ((request.kind === 'deploy' || request.kind === 'update') && typeof request.contentVersion !== 'string')
    || (request.kind === 'deploy' && (typeof request.includeReShade !== 'boolean' || (request.profile !== null && !['fidelity', 'balanced', 'performance'].includes(request.profile))))
    || (request.kind === 'profile' && !['fidelity', 'balanced', 'performance'].includes(request.profile))
    || (request.kind === 'enabled' && typeof request.enabled !== 'boolean')) throw new Error('The administrator resume request is invalid.')
  return { localAppData, request }
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
    await platform.writeText(path, JSON.stringify({ schemaVersion: 1, request }))
    requested = true
    try { await platform.requestElevation(path) }
    catch (error) { requested = false; await platform.removeFile(path); throw error }
    return false
  }
}
