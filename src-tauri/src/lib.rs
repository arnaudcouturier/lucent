mod platform;

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
            platform_dev_content
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lucent");
}
