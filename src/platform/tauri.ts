// The real Platform port: each method is one Rust primitive (src-tauri/src/platform.rs).
import { Channel, invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { PlatformError, type FileStat, type GpuAdapter, type LocalContent, type Platform, type PlatformErrorKind } from '../core/platform'

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
    getGpuAdapters: () => call<GpuAdapter[]>('platform_gpu_adapters', {}),
    fetchText: (url) => call<string>('platform_fetch_text', { url }),
    getDevContent: () => call<LocalContent | null>('platform_dev_content', {}),
    writeText: (path, text, stagingDirectory) => call('platform_write_text', { path, text, stagingDirectory }),
    writeFileByte: (path, offset, value) => call('platform_write_file_byte', { path, offset, value }),
    copyFile: (from, to, replace = true, stagingDirectory) => call('platform_copy_file', { from, to, replace, stagingDirectory }),
    renameFile: (from, to, replace = true) => call('platform_rename_file', { from, to, replace }),
    removeFile: (path) => call('platform_remove_file', { path }),
    removeDirectoryIfEmpty: (path) => call('platform_remove_directory_if_empty', { path }),
    listFiles: (root) => call('platform_list_files', { root }),
    hashFile: (path) => call('platform_hash_file', { path }),
    resolveGamePath: (root, relative) => call('platform_resolve_game_path', { root, relative }),
    isGameRunning: () => call('platform_is_game_running', {}),
    isDirectoryWritable: (path, targets = []) => call('platform_is_directory_writable', { path, targets }),
    isElevated: () => call('platform_is_elevated', {}),
    getElevationResumePath: () => call('platform_elevation_resume_path', {}),
    requestElevation: (resumePath) => call('platform_request_elevation', { resumePath }),
    exePath: () => call<string>('platform_exe_path', {}),
    launchExe: (path) => call('platform_launch_exe', { path }),
    downloadFile: (url, to, progress) => {
      const channel = new Channel<number>()
      channel.onmessage = progress
      return call('platform_download_file', { url, to, progress: channel })
    },
    async pickFolder({ title }) {
      const picked = await open({ directory: true, multiple: false, title })
      return typeof picked === 'string' ? picked : null
    },
  }
}
