//! The real Platform port: dumb primitives over the machine, one per Tauri command.
//! All logic lives in the TypeScript core; these only touch the machine and classify failures
//! into the port's error kinds (see `src/core/platform.ts`).

use serde::Serialize;
use std::fs;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
use winreg::RegKey;
use windows::core::{HSTRING, Interface};
use windows::Win32::Foundation::{GlobalFree, HANDLE, HWND};
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIDevice, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, DXGI_ERROR_NOT_FOUND};
use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

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

/// Reads and normalizes only the last `max_lines` of a potentially large text log.
/// A single terminal LF or CRLF is excluded, matching `readTextTail` in the fake platform.
pub fn read_text_tail(path: &Path, max_lines: usize) -> Result<String> {
    const MAX_LINES: usize = 10_000;
    const SCAN_CHUNK_SIZE: u64 = 8 * 1024;
    if !(1..=MAX_LINES).contains(&max_lines) {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            format!("Line count must be between 1 and {MAX_LINES}"),
            Some(path),
        ));
    }

    let mut file = fs::File::open(path).map_err(|e| PlatformError::io(e, Some(path)))?;
    let file_len = file.seek(SeekFrom::End(0)).map_err(|e| PlatformError::io(e, Some(path)))?;

    // Match the fake platform's trailing-newline behavior: drop exactly one final LF,
    // along with its CR when the file uses CRLF.
    let mut content_end = file_len;
    if content_end > 0 {
        file.seek(SeekFrom::Start(content_end - 1)).map_err(|e| PlatformError::io(e, Some(path)))?;
        let mut last_byte = [0; 1];
        file.read_exact(&mut last_byte).map_err(|e| PlatformError::io(e, Some(path)))?;
        if last_byte[0] == b'\n' {
            content_end -= 1;
            if content_end > 0 {
                file.seek(SeekFrom::Start(content_end - 1)).map_err(|e| PlatformError::io(e, Some(path)))?;
                file.read_exact(&mut last_byte).map_err(|e| PlatformError::io(e, Some(path)))?;
                if last_byte[0] == b'\r' {
                    content_end -= 1;
                }
            }
        }
    }

    // Scan backward until the byte after the max_lines-th preceding LF is found.
    // This avoids decoding or allocating the potentially huge prefix of the log.
    let mut cursor = content_end;
    let mut line_breaks = 0;
    let mut tail_start = 0;
    let mut found_start = false;
    let mut chunk = vec![0; SCAN_CHUNK_SIZE as usize];
    while cursor > 0 {
        let chunk_start = cursor.saturating_sub(SCAN_CHUNK_SIZE);
        let chunk_len = (cursor - chunk_start) as usize;
        file.seek(SeekFrom::Start(chunk_start)).map_err(|e| PlatformError::io(e, Some(path)))?;
        file.read_exact(&mut chunk[..chunk_len]).map_err(|e| PlatformError::io(e, Some(path)))?;

        for (index, byte) in chunk[..chunk_len].iter().enumerate().rev() {
            if *byte == b'\n' {
                line_breaks += 1;
                if line_breaks == max_lines {
                    tail_start = chunk_start + index as u64 + 1;
                    found_start = true;
                    break;
                }
            }
        }
        if found_start {
            break;
        }
        cursor = chunk_start;
    }

    if !found_start {
        tail_start = 0;
    }
    file.seek(SeekFrom::Start(tail_start)).map_err(|e| PlatformError::io(e, Some(path)))?;
    let mut tail = Vec::new();
    file.take(content_end - tail_start)
        .read_to_end(&mut tail)
        .map_err(|e| PlatformError::io(e, Some(path)))?;

    Ok(String::from_utf8_lossy(&tail).replace("\r\n", "\n"))
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub driver_version: Option<String>,
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
            // DXGI reports the user-mode driver version as four packed 16-bit values.
            // This query is optional: an adapter that does not support it must still be listed.
            let driver_version = adapter.CheckInterfaceSupport(&IDXGIDevice::IID).ok().map(|version| {
                let version = version as u64;
                format!(
                    "{}.{}.{}.{}",
                    (version >> 48) & 0xffff,
                    (version >> 32) & 0xffff,
                    (version >> 16) & 0xffff,
                    version & 0xffff,
                )
            });
            adapters.push(GpuAdapter {
                name: String::from_utf16_lossy(&desc.Description[..len]),
                vendor_id: desc.VendorId,
                dedicated_memory: desc.DedicatedVideoMemory as u64,
                software: desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0,
                driver_version,
            });
        }
        Ok(adapters)
    }
}

/// Returns the Windows display version and build, using the build number to distinguish
/// Windows 11 from older ProductName strings that still say "Windows 10".
pub fn windows_version() -> Result<String> {
    const CURRENT_VERSION_KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let key = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(CURRENT_VERSION_KEY, KEY_READ)
        .map_err(|e| PlatformError::io(e, None))?;
    let build_value: String = key.get_value("CurrentBuildNumber").map_err(|e| PlatformError::io(e, None))?;
    let build = build_value.parse::<u32>().map_err(|e| {
        PlatformError::new(ErrorKind::Unknown, format!("Invalid Windows build number: {e}"), None)
    })?;
    let display_version: String = key.get_value("DisplayVersion").map_err(|e| PlatformError::io(e, None))?;
    let ubr: u32 = key.get_value("UBR").map_err(|e| PlatformError::io(e, None))?;
    let family = if build >= 22_000 { "Windows 11" } else { "Windows 10" };

    Ok(format!("{family} {display_version} (build {build}.{ubr})"))
}

/// Copies Unicode text using the app's actual top-level window as the clipboard owner.
/// The system takes ownership of the movable global memory only after SetClipboardData succeeds.
pub fn copy_text(text: &str, owner: HWND) -> Result<()> {
    const CF_UNICODETEXT: u32 = 13;
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    let bytes = wide.len() * std::mem::size_of::<u16>();

    // SAFETY: `owner` is obtained from Tauri's live native window. The clipboard is always
    // closed after a successful open, and its HGLOBAL is freed unless Windows takes ownership.
    unsafe {
        OpenClipboard(Some(owner)).map_err(win32_error)?;
        let result = (|| {
            EmptyClipboard().map_err(win32_error)?;
            let memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes).map_err(win32_error)?;
            let pointer = GlobalLock(memory);
            if pointer.is_null() {
                let _ = GlobalFree(Some(memory));
                return Err(PlatformError::new(ErrorKind::Unknown, "Windows could not lock clipboard memory", None));
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), pointer.cast::<u16>(), wide.len());
            // GlobalUnlock returns false when the lock count reaches zero, which is its normal
            // success case. It is sufficient here to release the single lock we acquired.
            let _ = GlobalUnlock(memory);

            if let Err(error) = SetClipboardData(CF_UNICODETEXT, Some(HANDLE(memory.0))) {
                let _ = GlobalFree(Some(memory));
                return Err(win32_error(error));
            }
            Ok(())
        })();
        let close_result = CloseClipboard().map_err(win32_error);
        result?;
        close_result?;
    }
    Ok(())
}

/// Opens an HTTPS URL in the user's default browser.
pub fn open_url(url: &str, owner: HWND) -> Result<()> {
    if url.contains('\0') {
        return Err(PlatformError::new(ErrorKind::Unknown, "URL contains an embedded NUL", None));
    }
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| PlatformError::new(ErrorKind::Unknown, format!("Invalid URL: {e}"), None))?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err(PlatformError::new(ErrorKind::Unknown, "Only HTTPS URLs can be opened", None));
    }
    let target = HSTRING::from(parsed.as_str());
    let operation = HSTRING::from("open");

    // SAFETY: the HSTRING values stay alive for the call and `owner` is Tauri's live window.
    let result = unsafe {
        ShellExecuteW(Some(owner), &operation, &target, None, None, SW_SHOWNORMAL)
    };
    let code = result.0 as usize;
    if code <= 32 {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            format!("Windows could not open the URL (ShellExecuteW error {code})"),
            None,
        ));
    }
    Ok(())
}

fn win32_error(error: windows::core::Error) -> PlatformError {
    PlatformError::new(ErrorKind::Unknown, error.to_string(), None)
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
    let mut command = std::process::Command::new(path);
    if let Some(resume) = elevation_resume_path() { command.arg("--lucent-resume").arg(resume); }
    command
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

/// Checks only the requested write targets and their existing parents, without modifying their bytes.
pub fn game_write_access(root: &Path, targets: &[String]) -> Result<bool> {
    use std::collections::BTreeSet;
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{DELETE, FILE_FLAG_BACKUP_SEMANTICS};
    if !is_directory_writable(root)? { return Ok(false); }
    let mut directories = BTreeSet::new();
    directories.insert(root.to_owned());
    for relative in targets {
        let path = crate::files::resolve_game_path(root, relative)?;
        match fs::metadata(&path) {
            Ok(meta) => {
                // Atomic replacement and removal need delete access to an existing target.
                match fs::OpenOptions::new().access_mode(DELETE.0)
                    .custom_flags(if meta.is_dir() { FILE_FLAG_BACKUP_SEMANTICS.0 } else { 0 }).open(&path) {
                    Ok(_) => {},
                    Err(e) if e.kind() == io::ErrorKind::PermissionDenied => return Ok(false),
                    Err(e) => return Err(PlatformError::io(e, Some(&path))),
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {},
            Err(e) => return Err(PlatformError::io(e, Some(&path))),
        }
        let mut parent = path.parent();
        while let Some(directory) = parent {
            match fs::metadata(directory) {
                Ok(meta) if meta.is_dir() => {
                    if directories.insert(directory.to_owned()) && !is_directory_writable(directory)? { return Ok(false); }
                    break;
                }
                Ok(_) => return Err(PlatformError::new(ErrorKind::AccessDenied, "A write target's parent is a file.", Some(directory))),
                Err(e) if e.kind() == io::ErrorKind::NotFound => parent = directory.parent(),
                Err(e) => return Err(PlatformError::io(e, Some(directory))),
            }
        }
    }
    Ok(true)
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
    fn game_write_probe_checks_protected_subfolders_and_leaves_contents_intact() {
        use std::os::windows::process::CommandExt;
        let dir = tempfile::tempdir().unwrap();
        let shaders = dir.path().join("shaders");
        fs::create_dir(&shaders).unwrap();
        fs::write(shaders.join("Existing.fx"), "User shader").unwrap();
        let acl = |args: &[&str]| std::process::Command::new("icacls")
            .arg(&shaders).args(args).creation_flags(0x08000000).output().unwrap();
        assert!(acl(&["/deny", "*S-1-1-0:(WD,AD)"]).status.success());
        let result = game_write_access(dir.path(), &["shaders/New.fx".into()]);
        // An unrelated protected subfolder does not require elevation for a write in the root.
        let unrelated = game_write_access(dir.path(), &["OptiScaler.ini".into()]);
        assert!(acl(&["/remove:d", "*S-1-1-0"]).status.success());
        assert!(!result.unwrap());
        assert!(unrelated.unwrap());
        assert_eq!(fs::read_to_string(shaders.join("Existing.fx")).unwrap(), "User shader");
        assert_eq!(fs::read_dir(&shaders).unwrap().count(), 1);
    }

    #[test]
    fn game_write_probe_checks_replacement_access_to_existing_files() {
        use std::os::windows::process::CommandExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("OptiScaler.ini");
        fs::write(&file, "Passes = 2").unwrap();
        let acl = |path: &Path, args: &[&str]| std::process::Command::new("icacls")
            .arg(path).args(args).creation_flags(0x08000000).output().unwrap();
        // Replacement can use DELETE on the file or DELETE_CHILD on its parent. Deny both.
        assert!(acl(dir.path(), &["/deny", "*S-1-1-0:(DC)"]).status.success());
        assert!(acl(&file, &["/deny", "*S-1-1-0:(D)"]).status.success());
        let result = game_write_access(dir.path(), &["OptiScaler.ini".into()]);
        assert!(acl(&file, &["/remove:d", "*S-1-1-0"]).status.success());
        assert!(acl(dir.path(), &["/remove:d", "*S-1-1-0"]).status.success());
        assert!(!result.unwrap());
        assert_eq!(fs::read_to_string(file).unwrap(), "Passes = 2");
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

    #[test]
    fn tail_reads_the_last_300_crlf_lines_without_a_terminal_newline() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("OptiScaler.log");
        let source_lines: Vec<_> = (0..650).map(|line| format!("line-{line:03}")).collect();
        fs::write(&path, format!("{}\r\n", source_lines.join("\r\n"))).unwrap();

        let actual = read_text_tail(&path, 300).unwrap();
        let expected = source_lines[350..].join("\n");
        assert_eq!(actual, expected);
    }

    #[test]
    fn tail_handles_short_empty_and_blank_final_lines_like_the_fake_platform() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("log.txt");
        for (source, max_lines, expected) in [
            ("", 300, ""),
            ("one\n", 300, "one"),
            ("one\r\n", 300, "one"),
            ("one\n\n", 300, "one\n"),
            ("one\r\n\r\n", 300, "one\n"),
            ("one\ntwo\nthree", 2, "two\nthree"),
            ("\n\n", 1, ""),
        ] {
            fs::write(&path, source).unwrap();
            assert_eq!(read_text_tail(&path, max_lines).unwrap(), expected, "source {source:?}");
        }
    }

    #[test]
    fn tail_lossily_decodes_invalid_utf8_and_keeps_utf8_across_the_scan_chunk_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("log.txt");
        // Align the file end to the 8 KiB scan size so the four-byte character starting at byte
        // 8191 crosses a chunk boundary.
        let first_line = format!("{}🫧{}", "x".repeat(8191), "x".repeat(8184));
        let source = format!("{first_line}\nlast");
        assert_eq!(source.len(), 16 * 1024);
        fs::write(&path, &source).unwrap();

        let tail = read_text_tail(&path, 2).unwrap();
        assert_eq!(tail, source);

        fs::write(&path, b"first\nbad \xff\xfe\nlast").unwrap();
        assert_eq!(read_text_tail(&path, 2).unwrap(), "bad ��\nlast");
    }

    #[test]
    fn tail_rejects_invalid_line_counts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("log.txt");
        fs::write(&path, "line\n").unwrap();

        for max_lines in [0, 10_001] {
            let error = read_text_tail(&path, max_lines).unwrap_err();
            assert_eq!(error.kind, ErrorKind::Unknown);
            assert_eq!(error.path.as_deref(), Some(path.to_str().unwrap()));
        }
    }

    #[test]
    fn tail_reads_from_the_end_of_a_125_mib_log() {
        use std::io::{Seek, SeekFrom, Write};

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("OptiScaler.log");
        let mut file = fs::File::create(&path).unwrap();
        let size = 125 * 1024 * 1024;
        file.set_len(size).unwrap();
        let final_lines: Vec<_> = (0..305).map(|line| format!("tail-{line:03}")).collect();
        let suffix = format!("{}\n", final_lines.join("\n"));
        file.seek(SeekFrom::End(-(suffix.len() as i64))).unwrap();
        file.write_all(suffix.as_bytes()).unwrap();
        drop(file);

        assert_eq!(read_text_tail(&path, 300).unwrap(), final_lines[5..].join("\n"));
    }
}
