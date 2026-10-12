import { PlatformError, type Platform } from './platform'
import { joinPath } from './paths'

export type XivLauncherState =
  | { status: 'idle' | 'scanning' }
  | { status: 'found'; configPath: string }
  | { status: 'not-found' }
  | { status: 'unavailable'; message: string }

export async function xivLauncherConfigPath(platform: Platform): Promise<string> {
  return joinPath(await platform.envFolder('AppData'), 'XIVLauncher', 'launcherConfigV3.json')
}

export async function scanXivLauncher(platform: Platform): Promise<XivLauncherState> {
  try {
    const configPath = await xivLauncherConfigPath(platform)
    return (await platform.stat(configPath)).kind === 'file' ? { status: 'found', configPath } : { status: 'not-found' }
  } catch (error) {
    if (error instanceof PlatformError && error.kind === 'not-found') return { status: 'not-found' }
    return { status: 'unavailable', message: error instanceof Error ? error.message : String(error) }
  }
}
