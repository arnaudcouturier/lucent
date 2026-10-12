// The real Platform port: each method is one Rust primitive (src-tauri/src/platform.rs).
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { PlatformError, type FileStat, type Platform, type PlatformErrorKind } from '../core/platform'

interface RawError {
  kind: PlatformErrorKind
  message: string
  path?: string
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (e) {
    const raw = e as Partial<RawError>
    throw new PlatformError(raw.kind ?? 'unknown', raw.message ?? String(e), raw.path)
  }
}

export function createTauriPlatform(): Platform {
  return {
    readText: (path) => call<string>('platform_read_text', { path }),
    stat: (path) => call<FileStat>('platform_stat', { path }),
    readRegistry: (hive, key, value) => call<string>('platform_read_registry', { hive, key, value }),
    envFolder: (folder) => call<string>('platform_env_folder', { folder }),
    async pickFolder({ title }) {
      const picked = await open({ directory: true, multiple: false, title })
      return typeof picked === 'string' ? picked : null
    },
  }
}
