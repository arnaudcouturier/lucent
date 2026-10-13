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
async fn platform_read_text_tail(path: PathBuf, max_lines: usize) -> Result<String, PlatformError> {
    platform::read_text_tail(&path, max_lines)
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
async fn platform_windows_version() -> Result<String, PlatformError> {
    platform::windows_version()
}

#[tauri::command]
async fn platform_copy_text(window: tauri::WebviewWindow, text: String) -> Result<(), PlatformError> {
    let owner = window.hwnd().map_err(|e| PlatformError {
        kind: platform::ErrorKind::Unknown,
        message: e.to_string(),
        path: None,
    })?;
    platform::copy_text(&text, owner)
}

#[tauri::command]
async fn platform_open_url(window: tauri::WebviewWindow, url: String) -> Result<(), PlatformError> {
    let owner = window.hwnd().map_err(|e| PlatformError {
        kind: platform::ErrorKind::Unknown,
        message: e.to_string(),
        path: None,
    })?;
    platform::open_url(&url, owner)
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
async fn platform_is_process_running(exe_name: String) -> Result<bool, PlatformError> { files::is_process_running(&exe_name) }
#[tauri::command]
async fn platform_notify(title: String, body: String) -> Result<(), PlatformError> { platform::notify(&title, &body) }
#[tauri::command]
async fn platform_exit(app: tauri::AppHandle) { app.exit(0) }
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

#[tauri::command]
async fn platform_create_shortcut(path: PathBuf, target: PathBuf) -> Result<(), PlatformError> { platform::create_shortcut(&path, &target) }
#[tauri::command]
async fn platform_set_uninstall_entry(id: String, values: serde_json::Map<String, serde_json::Value>) -> Result<(), PlatformError> { platform::set_uninstall_entry(&id, &values) }
#[tauri::command]
async fn platform_remove_uninstall_entry(id: String) -> Result<(), PlatformError> { platform::remove_uninstall_entry(&id) }
#[tauri::command]
async fn platform_headless_mode() -> Option<String> { platform::headless_mode().map(str::to_owned) }
#[tauri::command]
async fn platform_exit_and_remove(app: tauri::AppHandle, folders: Vec<PathBuf>) -> Result<(), PlatformError> {
    use tauri::Manager;
    // The WebView2 data folder is only released once this process ends, so it goes in the same script.
    let webview: Vec<PathBuf> = app.path().app_local_data_dir().ok().filter(|p| p.exists()).into_iter().collect();
    platform::exit_and_remove(&folders, &webview)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let Some(window) = app.get_webview_window("main") else { return Ok(()) };
            match platform::headless_mode() {
                // A XIVLauncher add-on run: the window stays hidden while the webview does the work.
                Some("check" | "repair") => {
                    window.set_skip_taskbar(true)?;
                    // A stuck run would stay hidden, and XIVLauncher skips an add-on whose exe is still running.
                    std::thread::spawn(|| { std::thread::sleep(std::time::Duration::from_secs(30 * 60)); std::process::exit(1) });
                    return Ok(());
                }
                // Sized to --uninstall-width and --uninstall-height in tokens.css.
                Some("uninstall") => {
                    window.set_size(tauri::LogicalSize::new(460.0, 340.0))?;
                    window.center()?;
                    window.set_title("Uninstall Lucent")?;
                }
                _ => {}
            }
            window.show()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_read_text,
            platform_read_text_tail,
            platform_stat,
            platform_read_registry,
            platform_env_folder,
            platform_gpu_adapters,
            platform_windows_version,
            platform_copy_text,
            platform_open_url,
            platform_fetch_text,
            platform_dev_content,
            platform_write_text, platform_write_file_byte, platform_copy_file, platform_rename_file, platform_remove_file,
            platform_remove_directory_if_empty, platform_list_files, platform_hash_file, platform_resolve_game_path,
            platform_download_file, platform_is_game_running, platform_exe_path, platform_launch_exe,
            platform_is_directory_writable, platform_is_elevated, platform_elevation_resume_path, platform_request_elevation,
            platform_is_process_running, platform_notify, platform_exit,
            platform_create_shortcut, platform_set_uninstall_entry, platform_remove_uninstall_entry, platform_headless_mode,
            platform_exit_and_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lucent");
}
