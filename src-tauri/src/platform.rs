//! The real Platform port: dumb primitives over the machine, one per Tauri command.
//! All logic lives in the TypeScript core; these only touch the machine and classify failures
//! into the port's error kinds (see `src/core/platform.ts`).

use serde::Serialize;
use std::fs;
use std::io;
use std::path::Path;
use std::time::UNIX_EPOCH;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
use winreg::RegKey;
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, DXGI_ERROR_NOT_FOUND};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
#[allow(dead_code)] // HashMismatch arrives with downloads.
pub enum ErrorKind {
    NotFound,
    AccessDenied,
    Locked,
    DiskFull,
    Network,
    HashMismatch,
    Cancelled,
    Unknown,
}

#[derive(Debug, Serialize)]
pub struct PlatformError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

pub type Result<T> = std::result::Result<T, PlatformError>;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub kind: &'static str,
    pub size: u64,
    pub modified_ms: u64,
}

impl PlatformError {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>, path: Option<&Path>) -> Self {
        let path = path.map(|p| p.to_string_lossy().into_owned());
        PlatformError { kind, message: message.into(), path }
    }

    pub(crate) fn io(e: io::Error, path: Option<&Path>) -> Self {
        // Windows error codes first: std maps several of them to vague kinds.
        const ERROR_SHARING_VIOLATION: i32 = 32;
        const ERROR_LOCK_VIOLATION: i32 = 33;
        const ERROR_HANDLE_DISK_FULL: i32 = 39;
        const ERROR_DISK_FULL: i32 = 112;
        let kind = match (e.raw_os_error(), e.kind()) {
            (Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION), _) => ErrorKind::Locked,
            (Some(ERROR_HANDLE_DISK_FULL | ERROR_DISK_FULL), _) => ErrorKind::DiskFull,
            (_, io::ErrorKind::NotFound) => ErrorKind::NotFound,
            (_, io::ErrorKind::PermissionDenied) => ErrorKind::AccessDenied,
            _ => ErrorKind::Unknown,
        };
        PlatformError::new(kind, e.to_string(), path)
    }
}

/// Reads a UTF-8 text file, without the byte order mark some Windows tools write.
pub fn read_text(path: &Path) -> Result<String> {
    let text = fs::read_to_string(path).map_err(|e| PlatformError::io(e, Some(path)))?;
    Ok(text.strip_prefix('\u{feff}').map(str::to_owned).unwrap_or(text))
}

pub fn stat(path: &Path) -> Result<FileStat> {
    let meta = fs::metadata(path).map_err(|e| PlatformError::io(e, Some(path)))?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    Ok(FileStat { kind: if meta.is_dir() { "dir" } else { "file" }, size: meta.len(), modified_ms })
}

/// Reads a string value. `key` is the full subkey path under the hive (`HKCU` or `HKLM`).
pub fn read_registry(hive: &str, key: &str, value: &str) -> Result<String> {
    let root = match hive {
        "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        _ => return Err(PlatformError::new(ErrorKind::Unknown, format!("Unknown registry hive {hive}"), None)),
    };
    root.open_subkey_with_flags(key, KEY_READ)
        .and_then(|k| k.get_value::<String, _>(value))
        .map_err(|e| PlatformError::io(e, None))
}

/// Well-known folders, as Windows resolves them for the current user.
pub fn env_folder(folder: &str) -> Result<String> {
    let var = match folder {
        "AppData" => "APPDATA",
        "LocalAppData" => "LOCALAPPDATA",
        "ProgramFiles" => "ProgramFiles",
        "ProgramFilesX86" => "ProgramFiles(x86)",
        _ => return Err(PlatformError::new(ErrorKind::Unknown, format!("Unknown folder {folder}"), None)),
    };
    std::env::var(var).map_err(|_| PlatformError::new(ErrorKind::NotFound, format!("{var} is not set"), None))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuAdapter {
    pub name: String,
    pub vendor_id: u32,
    pub dedicated_memory: u64,
    pub software: bool,
}

/// Enumerates DXGI adapters. Choice and tier matching belong to the TypeScript core.
pub fn gpu_adapters() -> Result<Vec<GpuAdapter>> {
    let error = |e: windows::core::Error| PlatformError::new(ErrorKind::Unknown, e.to_string(), None);
    // SAFETY: the bindings manage the COM interfaces' lifetimes. GetDesc1 returns an owned descriptor;
    // no raw pointer or interface leaves this thread.
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().map_err(error)?;
        let mut adapters = Vec::new();
        for index in 0.. {
            let adapter = match factory.EnumAdapters1(index) {
                Ok(adapter) => adapter,
                Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
                Err(e) => return Err(error(e)),
            };
            let desc = adapter.GetDesc1().map_err(error)?;
            let len = desc.Description.iter().position(|c| *c == 0).unwrap_or(desc.Description.len());
            adapters.push(GpuAdapter {
                name: String::from_utf16_lossy(&desc.Description[..len]),
                vendor_id: desc.VendorId,
                dedicated_memory: desc.DedicatedVideoMemory as u64,
                software: desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0,
            });
        }
        Ok(adapters)
    }
}

/// Fetches text with a bounded wait. HTTP error bodies must never be parsed as manifests.
pub async fn fetch_text(url: &str) -> Result<String> {
    let error = |e: reqwest::Error| PlatformError::new(ErrorKind::Network, e.to_string(), None);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("Lucent/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(error)?;
    client.get(url).send().await.map_err(error)?.error_for_status().map_err(error)?.text().await.map_err(error)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalContent {
    pub manifest_path: String,
    pub files_directory: String,
}

/// Environment overrides are unavailable in the portable release app.
pub fn dev_content() -> Result<Option<LocalContent>> {
    if !cfg!(debug_assertions) {
        return Ok(None);
    }
    let Some(manifest) = std::env::var_os("LUCENT_DEV_MANIFEST") else { return Ok(None) };
    let manifest = std::path::absolute(manifest).map_err(|e| PlatformError::io(e, None))?;
    let files = match std::env::var_os("LUCENT_DEV_FILES") {
        Some(path) => std::path::absolute(path).map_err(|e| PlatformError::io(e, None))?,
        None => manifest.parent()
            .ok_or_else(|| PlatformError::new(ErrorKind::Unknown, "The dev manifest must name a file", None))?
            .join("files"),
    };
    Ok(Some(LocalContent {
        manifest_path: manifest.to_string_lossy().into_owned(),
        files_directory: files.to_string_lossy().into_owned(),
    }))
}

/// The running Lucent exe, which an app update renames aside and replaces.
pub fn exe_path() -> Result<String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| PlatformError::new(ErrorKind::Unknown, e.to_string(), None))
}

/// Starts the exe at `path`, then exits this process so the new one takes over.
pub fn launch_exe(path: &Path) -> Result<()> {
    std::process::Command::new(path)
        .spawn()
        .map_err(|e| PlatformError::io(e, Some(path)))?;
    std::process::exit(0)
}

/// A create/delete probe distinguishes access denial from a full disk or locked folder.
pub fn is_directory_writable(path: &Path) -> Result<bool> {
    if crate::files::is_game_running()? {
        return Err(PlatformError::new(ErrorKind::Locked, "Close XIV before changing the game folder.", Some(path)));
    }
    match tempfile::Builder::new().prefix(".lucent-access-").tempfile_in(path) {
        Ok(file) => { file.close().map_err(|e| PlatformError::io(e, Some(path)))?; Ok(true) }
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => Ok(false),
        Err(e) => Err(PlatformError::io(e, Some(path))),
    }
}

pub fn is_elevated() -> Result<bool> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    let error = |e: windows::core::Error| PlatformError::new(ErrorKind::Unknown, e.to_string(), None);
    // SAFETY: the token belongs to this process; the output buffer has the exact TOKEN_ELEVATION size.
    // Its handle is closed even when GetTokenInformation fails.
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(error)?;
        let mut elevation = TOKEN_ELEVATION::default();
        let mut size = 0;
        let result = GetTokenInformation(token, TokenElevation, Some((&mut elevation as *mut TOKEN_ELEVATION).cast()), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut size);
        let _ = CloseHandle(token);
        result.map_err(error)?;
        Ok(elevation.TokenIsElevated != 0)
    }
}

pub fn elevation_resume_path() -> Option<String> {
    let mut args = std::env::args_os().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--lucent-resume" { return args.next().map(|path| path.to_string_lossy().into_owned()); }
    }
    None
}

fn elevation_arguments(path: &Path) -> Result<String> {
    let path = path.to_str().ok_or_else(|| PlatformError::new(ErrorKind::Unknown, "The resume path is not UTF-8.", Some(path)))?;
    if path.contains(['"', '\0']) || !Path::new(path).is_absolute() || !path.ends_with(".json") {
        return Err(PlatformError::new(ErrorKind::Unknown, "Invalid administrator resume path.", Some(Path::new(path))));
    }
    Ok(format!("--lucent-resume \"{path}\""))
}

/// Uses Windows UAC rather than a shell. Cancellation leaves the current app running.
pub fn request_elevation(resume_path: &Path) -> Result<()> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, RPC_E_CHANGED_MODE};
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let exe = wide(&exe_path()?);
    let args = wide(&elevation_arguments(resume_path)?);
    // SAFETY: all UTF-16 buffers stay alive until the synchronous shell call returns.
    // COM is uninitialized only if this call initialized it; the child-process handle is closed.
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if initialized.is_err() && initialized != RPC_E_CHANGED_MODE {
            return Err(PlatformError::new(ErrorKind::Unknown, initialized.to_string(), None));
        }
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOASYNC | SEE_MASK_NOCLOSEPROCESS,
            lpVerb: w!("runas"), lpFile: PCWSTR(exe.as_ptr()), lpParameters: PCWSTR(args.as_ptr()),
            nShow: SW_SHOWNORMAL.0, ..Default::default()
        };
        let result = ShellExecuteExW(&mut info);
        if initialized.is_ok() { CoUninitialize(); }
        result.map_err(|e| {
            let cancelled = e.code().0 as u32 & 0xffff == 1223;
            let message = if cancelled { "Administrator access was cancelled.".to_owned() } else { e.to_string() };
            PlatformError::new(if cancelled { ErrorKind::Cancelled } else { ErrorKind::AccessDenied }, message, Some(resume_path))
        })?;
        if !info.hProcess.is_invalid() { let _ = CloseHandle(info.hProcess); }
    }
    std::process::exit(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn writable_folder_probe_leaves_no_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(is_directory_writable(dir.path()).unwrap());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn non_writable_folder_probe_reports_access_denial() {
        use std::os::windows::process::CommandExt;
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("protected-game");
        fs::create_dir(&folder).unwrap();
        // Everyone is denied file creation on this disposable fixture only, including an elevated runner.
        let acl = |args: &[&str]| std::process::Command::new("icacls")
            .arg(&folder).args(args).creation_flags(0x08000000).output().unwrap();
        assert!(acl(&["/deny", "*S-1-1-0:(WD,AD)"]).status.success());
        let result = is_directory_writable(&folder);
        assert!(acl(&["/remove:d", "*S-1-1-0"]).status.success());
        assert!(!result.unwrap());
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0);
    }

    #[test]
    fn names_the_running_exe() {
        let path = exe_path().unwrap();
        assert!(Path::new(&path).is_absolute(), "got {path}");
        assert!(!path.trim().is_empty());
    }

    #[test]
    fn reads_a_text_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("ffxivgame.ver");
        fs::write(&file, "2026.09.30.0000.0000").unwrap();

        assert_eq!(read_text(&file).unwrap(), "2026.09.30.0000.0000");
    }

    #[test]
    fn drops_a_utf8_byte_order_mark() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("launcherConfigV3.json");
        fs::write(&file, b"\xEF\xBB\xBF{\"GamePath\":\"C:\\\\Games\"}").unwrap();

        assert_eq!(read_text(&file).unwrap(), "{\"GamePath\":\"C:\\\\Games\"}");
    }

    #[test]
    fn a_missing_file_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope").join("ffxiv_dx11.exe");

        let err = read_text(&missing).unwrap_err();
        assert_eq!(err.kind, ErrorKind::NotFound);
        assert_eq!(err.path.as_deref(), Some(missing.to_str().unwrap()));
        assert_eq!(stat(&missing).unwrap_err().kind, ErrorKind::NotFound);
    }

    #[test]
    fn reading_a_folder_as_a_file_is_access_denied() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(read_text(dir.path()).unwrap_err().kind, ErrorKind::AccessDenied);
    }

    #[test]
    fn a_file_held_open_by_another_process_is_locked() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("winmm.dll");
        fs::write(&file, "MZ").unwrap();
        // Share mode 0: nobody else may open it, which is how a running game holds its DLLs.
        let _held = fs::OpenOptions::new().read(true).share_mode(0).open(&file).unwrap();

        assert_eq!(read_text(&file).unwrap_err().kind, ErrorKind::Locked);
    }

    #[test]
    fn stats_files_and_folders() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("ffxiv_dx11.exe");
        fs::write(&file, "MZ12").unwrap();

        let f = stat(&file).unwrap();
        assert_eq!((f.kind, f.size), ("file", 4));
        assert!(f.modified_ms > 1_600_000_000_000, "modified time is in ms since the epoch");
        assert_eq!(stat(dir.path()).unwrap().kind, "dir");
    }

    #[test]
    fn reads_a_registry_value() {
        let name = read_registry("HKLM", r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "ProductName").unwrap();

        assert!(name.starts_with("Windows"), "got {name}");
    }

    #[test]
    fn a_missing_registry_key_or_value_is_not_found() {
        let missing_key = read_registry("HKCU", r"Software\Lucent\DoesNotExist", "Value").unwrap_err();
        let missing_value = read_registry("HKLM", r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "NoSuchValue").unwrap_err();

        assert_eq!(missing_key.kind, ErrorKind::NotFound);
        assert_eq!(missing_value.kind, ErrorKind::NotFound);
    }

    #[test]
    fn resolves_well_known_folders() {
        for folder in ["AppData", "LocalAppData", "ProgramFiles", "ProgramFilesX86"] {
            let path = env_folder(folder).unwrap();
            assert!(Path::new(&path).is_dir(), "{folder} → {path}");
        }
        assert_eq!(env_folder("Desktop").unwrap_err().kind, ErrorKind::Unknown);
    }
}
