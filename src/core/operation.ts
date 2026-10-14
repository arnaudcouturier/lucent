import { PlatformError, type Platform } from './platform'
import { elevationResumeLocalAppData } from './gameAccess'
import { joinPath } from './paths'

/**
 * Journals, cache and settings are shared by Lucent processes. Hold their OS lease for a whole operation,
 * including recovery and its follow-up checks; an idle window holds none, so XIVLauncher can check or repair.
 */
export async function withOperationLock<T>(platform: Platform, work: () => Promise<T>): Promise<T> {
  const resume = await platform.getElevationResumePath()
  const localAppData = resume ? elevationResumeLocalAppData(resume) : await platform.envFolder('LocalAppData')
  let token: string
  try { token = await platform.acquireOperationLock(joinPath(localAppData, 'Lucent')) }
  catch (error) {
    if (error instanceof PlatformError && error.kind === 'locked') throw new Error('Another Lucent operation is using its files. Wait for it to finish, then try again.')
    throw error
  }
  try { return await work() }
  finally { await platform.releaseOperationLock(token) }
}
