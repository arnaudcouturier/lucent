mod platform;
mod files;

use platform::{FileStat, GpuAdapter, LocalContent, PlatformError};
use std::path::PathBuf;

// Async so the primitives run off the main thread and never stall the window.
#[tauri::command]
async fn platform_read_text(path: PathBuf) -> Result<String, PlatformError> {
    platform::read_text(&path)
}

#[tauri::command]
async fn platform_stat(path: PathBuf) -> Result<FileStat, PlatformError> {
    platform::stat(&path)
}

#[tauri::command]
async fn platform_read_registry(hive: String, key: String, value: String) -> Result<String, PlatformError> {
    platform::read_registry(&hive, &key, &value)
}

#[tauri::command]
async fn platform_env_folder(folder: String) -> Result<String, PlatformError> {
    platform::env_folder(&folder)
}

#[tauri::command]
async fn platform_gpu_adapters() -> Result<Vec<GpuAdapter>, PlatformError> {
    platform::gpu_adapters()
}

#[tauri::command]
async fn platform_fetch_text(url: String) -> Result<String, PlatformError> {
    platform::fetch_text(&url).await
}

#[tauri::command]
async fn platform_dev_content() -> Result<Option<LocalContent>, PlatformError> {
    platform::dev_content()
}

#[tauri::command]
async fn platform_write_text(path: PathBuf, text: String, staging_directory: Option<PathBuf>) -> Result<(), PlatformError> { files::write_text(&path, &text, staging_directory.as_deref()) }
#[tauri::command]
async fn platform_write_file_byte(path: PathBuf, offset: u64, value: u8) -> Result<(), PlatformError> { files::write_file_byte(&path, offset, value) }
#[tauri::command]
async fn platform_copy_file(from: PathBuf, to: PathBuf, replace: bool, staging_directory: Option<PathBuf>) -> Result<(), PlatformError> { files::copy_file(&from, &to, replace, staging_directory.as_deref()) }
#[tauri::command]
async fn platform_rename_file(from: PathBuf, to: PathBuf, replace: bool) -> Result<(), PlatformError> { files::rename_file(&from, &to, replace) }
#[tauri::command]
async fn platform_remove_file(path: PathBuf) -> Result<(), PlatformError> { files::remove_file(&path) }
#[tauri::command]
async fn platform_remove_directory_if_empty(path: PathBuf) -> Result<(), PlatformError> { files::remove_directory_if_empty(&path) }
#[tauri::command]
async fn platform_list_files(root: PathBuf) -> Result<Vec<String>, PlatformError> { files::list_files(&root) }
#[tauri::command]
async fn platform_hash_file(path: PathBuf) -> Result<String, PlatformError> { files::hash_file(&path) }
#[tauri::command]
async fn platform_resolve_game_path(root: PathBuf, relative: String) -> Result<String, PlatformError> {
    files::resolve_game_path(&root, &relative).map(|p| p.to_string_lossy().into_owned())
}
#[tauri::command]
async fn platform_download_file(url: String, to: PathBuf, progress: tauri::ipc::Channel<u64>) -> Result<(), PlatformError> {
    files::download_file(&url, &to, progress).await
}
#[tauri::command]
async fn platform_is_game_running() -> Result<bool, PlatformError> { files::is_game_running() }
#[tauri::command]
async fn platform_is_directory_writable(path: PathBuf, targets: Vec<String>) -> Result<bool, PlatformError> { platform::game_write_access(&path, &targets) }
#[tauri::command]
async fn platform_is_elevated() -> Result<bool, PlatformError> { platform::is_elevated() }
#[tauri::command]
async fn platform_elevation_resume_path() -> Option<String> { platform::elevation_resume_path() }
#[tauri::command]
async fn platform_request_elevation(resume_path: PathBuf) -> Result<(), PlatformError> { platform::request_elevation(&resume_path) }
#[tauri::command]
async fn platform_exe_path() -> Result<String, PlatformError> { platform::exe_path() }
#[tauri::command]
async fn platform_launch_exe(path: PathBuf) -> Result<(), PlatformError> { platform::launch_exe(&path) }

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            platform_read_text,
            platform_stat,
            platform_read_registry,
            platform_env_folder,
            platform_gpu_adapters,
            platform_fetch_text,
            platform_dev_content,
            platform_write_text, platform_write_file_byte, platform_copy_file, platform_rename_file, platform_remove_file,
            platform_remove_directory_if_empty, platform_list_files, platform_hash_file, platform_resolve_game_path,
            platform_download_file, platform_is_game_running, platform_exe_path, platform_launch_exe,
            platform_is_directory_writable, platform_is_elevated, platform_elevation_resume_path, platform_request_elevation
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lucent");
}
