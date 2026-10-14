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
    readTextTail: (path, maxLines) => call<string>('platform_read_text_tail', { path, maxLines }),
    getWindowsVersion: () => call<string>('platform_windows_version', {}),
    copyText: (text) => call('platform_copy_text', { text }),
    openUrl: (url) => call('platform_open_url', { url }),
    stat: (path) => call<FileStat>('platform_stat', { path }),
    readRegistry: (hive, key, value) => call<string>('platform_read_registry', { hive, key, value }),
    envFolder: (folder) => call<string>('platform_env_folder', { folder }),
    getGpuAdapters: () => call<GpuAdapter[]>('platform_gpu_adapters', {}),
    fetchText: (url) => call<string>('platform_fetch_text', { url }),
    getDevContent: () => call<LocalContent | null>('platform_dev_content', {}),
    acquireOperationLock: (dataFolder) => call<string>('platform_acquire_operation_lock', { dataFolder }),
    releaseOperationLock: (token) => call('platform_release_operation_lock', { token }),
    resetOperationLocks: () => call('platform_reset_operation_locks', {}),
    writeText: (path, text, stagingDirectory) => call('platform_write_text', { path, text, stagingDirectory }),
    appendText: (path, text) => call('platform_append_text', { path, text }),
    writeFileByte: (path, offset, value) => call('platform_write_file_byte', { path, offset, value }),
    copyFile: (from, to, replace = true, stagingDirectory) => call('platform_copy_file', { from, to, replace, stagingDirectory }),
    renameFile: (from, to, replace = true) => call('platform_rename_file', { from, to, replace }),
    removeFile: (path) => call('platform_remove_file', { path }),
    removeDirectoryIfEmpty: (path) => call('platform_remove_directory_if_empty', { path }),
    listFiles: (root) => call('platform_list_files', { root }),
    hashFile: (path) => call('platform_hash_file', { path }),
    resolveGamePath: (root, relative) => call('platform_resolve_game_path', { root, relative }),
    resolveGamePaths: (root, relatives) => relatives.length ? call('platform_resolve_game_paths', { root, relatives }) : Promise.resolve([]),
    statMany: (paths) => paths.length ? call('platform_stat_many', { paths }) : Promise.resolve([]),
    hashMany: (paths) => paths.length ? call('platform_hash_many', { paths }) : Promise.resolve([]),
    copyMany: (items, stagingDirectory) => items.length ? call('platform_copy_many', { items, stagingDirectory }) : Promise.resolve(),
    removeMany: (paths) => paths.length ? call('platform_remove_many', { paths }) : Promise.resolve(),
    writeFileBytes: (path, offsets, value) => offsets.length ? call('platform_write_file_bytes', { path, offsets, value }) : Promise.resolve(),
    removeDirectoriesIfEmpty: (paths) => paths.length ? call('platform_remove_directories_if_empty', { paths }) : Promise.resolve(),
    isGameRunning: () => call('platform_is_game_running', {}),
    isDirectoryWritable: (path, targets = []) => call('platform_is_directory_writable', { path, targets }),
    isElevated: () => call('platform_is_elevated', {}),
    getElevationResumePath: () => call('platform_elevation_resume_path', {}),
    requestElevation: (resumePath) => call('platform_request_elevation', { resumePath }),
    exePath: () => call<string>('platform_exe_path', {}),
    launchExe: (path) => call('platform_launch_exe', { path }),
    startProgram: (path) => call('platform_start_program', { path }),
    openSteamGame: (appId) => call('platform_open_steam_game', { appId }),
    isProcessRunning: (exeName) => call<boolean>('platform_is_process_running', { exeName }),
    notify: (title, body) => call('platform_notify', { title, body }),
    exit: () => call('platform_exit', {}),
    createShortcut: (path, target) => call('platform_create_shortcut', { path, target }),
    setUninstallEntry: (id, values) => call('platform_set_uninstall_entry', { id, values }),
    removeUninstallEntry: (id) => call('platform_remove_uninstall_entry', { id }),
    headlessMode: () => call('platform_headless_mode', {}),
    exitAndRemove: (folders) => call('platform_exit_and_remove', { folders }),
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
