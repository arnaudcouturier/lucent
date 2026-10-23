//! The real Platform port: dumb primitives over the machine, one per Tauri command.
//! All logic lives in the TypeScript core; these only touch the machine and classify failures
//! into the port's error kinds (see `src/core/platform.ts`).

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use windows::core::{Interface, HSTRING, PWSTR};
use windows::Win32::Devices::Display::{
    DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
    DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO, DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
    DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_DEVICE_INFO_TYPE,
    DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_RATIONAL,
    DISPLAYCONFIG_SOURCE_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
};
use windows::Win32::Foundation::{
    CloseHandle, GlobalFree, LocalFree, ERROR_INSUFFICIENT_BUFFER, HANDLE, HLOCAL, HWND, LPARAM,
    LUID, RPC_E_CHANGED_MODE,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_COLOR_SPACE_RGB_FULL_G10_NONE_P709, DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020,
    DXGI_COLOR_SPACE_RGB_STUDIO_G2084_NONE_P2020,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1, IDXGIFactory6, IDXGIOutput6,
    DXGI_ADAPTER_FLAG_SOFTWARE, DXGI_ERROR_NOT_FOUND, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE,
};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, EnumDisplaySettingsW, GetMonitorInfoW, DEVMODEW, ENUM_CURRENT_SETTINGS,
    HDC, HMONITOR, MONITORINFOEXW,
};
use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows::Win32::UI::HiDpi::{
    SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE,
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    ActivateKeyboardLayout, GetKeyNameTextW, GetKeyboardLayout, MapVirtualKeyExW,
    ACTIVATE_KEYBOARD_LAYOUT_FLAGS, HKL, MAPVK_VK_TO_VSC_EX,
};
use windows::Win32::UI::Shell::{
    FOLDERID_Documents, FOLDERID_Pictures, SHGetKnownFolderPath, ShellExecuteW, KNOWN_FOLDER_FLAG,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId, SW_SHOWNORMAL,
};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, HKEY_USERS, KEY_READ, KEY_WRITE};
use winreg::RegKey;

const MONITORINFOF_PRIMARY: u32 = 1;

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
    /// The Windows read-only attribute, which a replacement clears.
    pub read_only: bool,
}

impl PlatformError {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>, path: Option<&Path>) -> Self {
        let path = path.map(|p| p.to_string_lossy().into_owned());
        PlatformError {
            kind,
            message: message.into(),
            path,
        }
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
            // A temp file's writes come back re-wrapped with its path: the kind survives, the raw code does not.
            (_, io::ErrorKind::StorageFull) => ErrorKind::DiskFull,
            (_, io::ErrorKind::NotFound) => ErrorKind::NotFound,
            (_, io::ErrorKind::PermissionDenied) => ErrorKind::AccessDenied,
            _ => ErrorKind::Unknown,
        };
        PlatformError::new(kind, e.to_string(), path)
    }
}

/// Reads a UTF-8 text file, without the byte order mark some Windows tools write. A UTF-16 byte order mark
/// (Notepad's "UTF-16 LE" and "UTF-16 BE") is decoded as UTF-16 instead.
pub fn read_text(path: &Path) -> Result<String> {
    let bytes = fs::read(path).map_err(|e| PlatformError::io(e, Some(path)))?;
    decode_text(bytes).map_err(|why| PlatformError::new(ErrorKind::Unknown, why, Some(path)))
}

fn decode_text(bytes: Vec<u8>) -> std::result::Result<String, &'static str> {
    const NOT_UTF16: &str = "The file is not valid UTF-16 text.";
    let utf16 = |bytes: &[u8], unit: fn([u8; 2]) -> u16| {
        let (pairs, odd) = bytes.as_chunks::<2>();
        if !odd.is_empty() {
            return Err(NOT_UTF16);
        }
        char::decode_utf16(pairs.iter().map(|pair| unit(*pair)))
            .collect::<std::result::Result<String, _>>()
            .map_err(|_| NOT_UTF16)
    };
    match bytes.as_slice() {
        [0xff, 0xfe, rest @ ..] => utf16(rest, u16::from_le_bytes),
        [0xfe, 0xff, rest @ ..] => utf16(rest, u16::from_be_bytes),
        _ => {
            let text = String::from_utf8(bytes).map_err(|_| "The file is not valid UTF-8 text.")?;
            Ok(text
                .strip_prefix('\u{feff}')
                .map(str::to_owned)
                .unwrap_or(text))
        }
    }
}

/// Reads and normalizes only the last `max_lines` of a potentially large text log.
/// A single terminal LF or CRLF is excluded, matching `readTextTail` in the fake platform.
pub fn read_text_tail(path: &Path, max_lines: usize) -> Result<String> {
    read_text_tail_limited(path, max_lines, MAX_TAIL_BYTES)
}

/// The most of a log's end `read_text_tail` reads: the Logs section asks for 500 lines every second, and the
/// activity log keeps 2,000. A log with few line breaks is cut here, from the start of a line where one is in reach.
const MAX_TAIL_BYTES: u64 = 2 * 1024 * 1024;

fn read_text_tail_limited(path: &Path, max_lines: usize, max_bytes: u64) -> Result<String> {
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
    let file_len = file
        .seek(SeekFrom::End(0))
        .map_err(|e| PlatformError::io(e, Some(path)))?;

    // Match the fake platform's trailing-newline behavior: drop exactly one final LF,
    // along with its CR when the file uses CRLF.
    let mut content_end = file_len;
    if content_end > 0 {
        file.seek(SeekFrom::Start(content_end - 1))
            .map_err(|e| PlatformError::io(e, Some(path)))?;
        let mut last_byte = [0; 1];
        file.read_exact(&mut last_byte)
            .map_err(|e| PlatformError::io(e, Some(path)))?;
        if last_byte[0] == b'\n' {
            content_end -= 1;
            if content_end > 0 {
                file.seek(SeekFrom::Start(content_end - 1))
                    .map_err(|e| PlatformError::io(e, Some(path)))?;
                file.read_exact(&mut last_byte)
                    .map_err(|e| PlatformError::io(e, Some(path)))?;
                if last_byte[0] == b'\r' {
                    content_end -= 1;
                }
            }
        }
    }

    // Scan backward until the byte after the max_lines-th preceding LF is found, but never past the byte window.
    // This avoids decoding or allocating the potentially huge prefix of the log.
    let window_start = content_end.saturating_sub(max_bytes);
    let mut cursor = content_end;
    let mut line_breaks = 0;
    let mut earliest_break = None;
    let mut found_start = None;
    let mut chunk = vec![0; SCAN_CHUNK_SIZE as usize];
    while cursor > window_start && found_start.is_none() {
        let chunk_start = cursor.saturating_sub(SCAN_CHUNK_SIZE).max(window_start);
        let chunk_len = (cursor - chunk_start) as usize;
        file.seek(SeekFrom::Start(chunk_start))
            .map_err(|e| PlatformError::io(e, Some(path)))?;
        file.read_exact(&mut chunk[..chunk_len])
            .map_err(|e| PlatformError::io(e, Some(path)))?;

        for (index, byte) in chunk[..chunk_len].iter().enumerate().rev() {
            if *byte == b'\n' {
                let at = chunk_start + index as u64;
                earliest_break = Some(at);
                line_breaks += 1;
                if line_breaks == max_lines {
                    found_start = Some(at + 1);
                    break;
                }
            }
        }
        cursor = chunk_start;
    }

    // Fewer lines than asked for: the whole file when the window holds it, otherwise the whole lines in the window,
    // or, with no line break in reach, the window itself.
    let (tail_start, mid_line) = match (found_start, earliest_break) {
        (Some(start), _) => (start, false),
        _ if window_start == 0 => (0, false),
        (None, Some(at)) => (at + 1, false),
        (None, None) => (window_start, true),
    };
    file.seek(SeekFrom::Start(tail_start))
        .map_err(|e| PlatformError::io(e, Some(path)))?;
    let mut tail = Vec::new();
    file.take(content_end - tail_start)
        .read_to_end(&mut tail)
        .map_err(|e| PlatformError::io(e, Some(path)))?;
    if mid_line {
        // Start on a whole UTF-8 character: skip the continuation bytes of one the window cut.
        let cut = tail
            .iter()
            .take(3)
            .take_while(|byte| **byte & 0xc0 == 0x80)
            .count();
        tail.drain(..cut);
    }

    Ok(String::from_utf8_lossy(&tail).replace("\r\n", "\n"))
}

pub fn stat(path: &Path) -> Result<FileStat> {
    let meta = fs::metadata(path).map_err(|e| PlatformError::io(e, Some(path)))?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    Ok(FileStat {
        kind: if meta.is_dir() { "dir" } else { "file" },
        size: meta.len(),
        modified_ms,
        read_only: meta.permissions().readonly(),
    })
}

/// Reads a string value. `key` is the full subkey path under the hive (`HKCU` or `HKLM`).
pub fn read_registry(hive: &str, key: &str, value: &str) -> Result<String> {
    let root = match hive {
        "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        _ => {
            return Err(PlatformError::new(
                ErrorKind::Unknown,
                format!("Unknown registry hive {hive}"),
                None,
            ))
        }
    };
    root.open_subkey_with_flags(key, KEY_READ)
        .and_then(|k| k.get_value::<String, _>(value))
        .map_err(|e| PlatformError::io(e, None))
}

struct TokenHandle(HANDLE);

impl Drop for TokenHandle {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}

/// Returns the SID from this process token so an elevated relaunch can still target the player.
pub fn current_user_sid() -> Result<String> {
    let mut token = HANDLE::default();
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
        .map_err(|error| PlatformError::new(ErrorKind::Unknown, error.to_string(), None))?;
    let _token = TokenHandle(token);
    let mut length = 0;
    let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut length) };
    if length < std::mem::size_of::<TOKEN_USER>() as u32 {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            "Windows returned an invalid user token.",
            None,
        ));
    }
    let mut buffer = vec![0u8; length as usize];
    unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            length,
            &mut length,
        )
    }
    .map_err(|error| PlatformError::new(ErrorKind::Unknown, error.to_string(), None))?;
    let user = unsafe { &*(buffer.as_ptr().cast::<TOKEN_USER>()) };
    let mut sid = PWSTR::null();
    unsafe { ConvertSidToStringSidW(user.User.Sid, &mut sid) }
        .map_err(|error| PlatformError::new(ErrorKind::Unknown, error.to_string(), None))?;
    let result = unsafe { sid.to_string() };
    let _ = unsafe { LocalFree(Some(HLOCAL(sid.0 as _))) };
    result.map_err(|error| PlatformError::new(ErrorKind::Unknown, error.to_string(), None))
}

const USER_GPU_PREFERENCES_KEY: &str = r"Software\Microsoft\DirectX\UserGpuPreferences";

fn user_gpu_preferences_subkey(user_sid: &str) -> Result<String> {
    let mut parts = user_sid.split('-');
    let valid = parts.next() == Some("S")
        && parts.next() == Some("1")
        && parts
            .next()
            .is_some_and(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
        && parts.clone().count() >= 1
        && parts.all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()));
    if !valid {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            "The player account SID is invalid.",
            None,
        ));
    }
    Ok(format!(r"{user_sid}\{USER_GPU_PREFERENCES_KEY}"))
}

/// Reads one executable's REG_SZ value from the recorded player's loaded HKU hive.
pub fn read_user_gpu_preferences(user_sid: &str, executable_path: &str) -> Result<Option<String>> {
    let subkey = user_gpu_preferences_subkey(user_sid)?;
    let key = match RegKey::predef(HKEY_USERS).open_subkey_with_flags(&subkey, KEY_READ) {
        Ok(key) => key,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(PlatformError::io(error, None)),
    };
    match key.get_value::<String, _>(executable_path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(PlatformError::io(error, None)),
    }
}

/// Writes or removes one executable value under the recorded player's SID, never process HKCU.
pub fn write_user_gpu_preferences(
    user_sid: &str,
    executable_path: &str,
    value: Option<&str>,
) -> Result<()> {
    let subkey = user_gpu_preferences_subkey(user_sid)?;
    if let Some(value) = value {
        let (key, _) = RegKey::predef(HKEY_USERS)
            .create_subkey_with_flags(&subkey, KEY_WRITE)
            .map_err(|error| PlatformError::io(error, None))?;
        key.set_value(executable_path, &value)
            .map_err(|error| PlatformError::io(error, None))
    } else {
        let key = match RegKey::predef(HKEY_USERS).open_subkey_with_flags(&subkey, KEY_WRITE) {
            Ok(key) => key,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(PlatformError::io(error, None)),
        };
        match key.delete_value(executable_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(PlatformError::io(error, None)),
        }
    }
}

/// Well-known folders, as Windows resolves them for the current user.
pub fn env_folder(folder: &str) -> Result<String> {
    match folder {
        "Documents" => return known_folder(&FOLDERID_Documents),
        "Pictures" => return known_folder(&FOLDERID_Pictures),
        _ => {}
    }
    let var = match folder {
        "AppData" => "APPDATA",
        "LocalAppData" => "LOCALAPPDATA",
        "ProgramFiles" => "ProgramFiles",
        "ProgramFilesX86" => "ProgramFiles(x86)",
        _ => {
            return Err(PlatformError::new(
                ErrorKind::Unknown,
                format!("Unknown folder {folder}"),
                None,
            ))
        }
    };
    std::env::var(var)
        .map_err(|_| PlatformError::new(ErrorKind::NotFound, format!("{var} is not set"), None))
}

fn known_folder(id: &windows::core::GUID) -> Result<String> {
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_MULTITHREADED,
    };

    // SHGetKnownFolderPath resolves the current user's folder wherever the profile redirects it (Documents, Pictures).
    // SAFETY: COM is initialized for this synchronous call; the returned CoTaskMem string
    // is converted and freed before returning. An existing apartment is left untouched.
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_MULTITHREADED);
        if initialized.is_err() && initialized != RPC_E_CHANGED_MODE {
            return Err(PlatformError::new(
                ErrorKind::Unknown,
                initialized.to_string(),
                None,
            ));
        }

        let path = SHGetKnownFolderPath(id, KNOWN_FOLDER_FLAG(0), None);
        if initialized.is_ok() {
            CoUninitialize();
        }
        let path =
            path.map_err(|error| PlatformError::new(ErrorKind::Unknown, error.to_string(), None))?;
        let text = path.to_string();
        CoTaskMemFree(Some(path.0 as *const _));
        text.map_err(|error| PlatformError::new(ErrorKind::Unknown, error.to_string(), None))
    }
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorBounds {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub device_name: String,
    pub bounds: MonitorBounds,
    pub primary: bool,
    pub refresh_hz: f64,
    pub width: u32,
    pub height: u32,
    pub hdr_supported: bool,
    pub hdr_on: bool,
    pub peak_nits: Option<f32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct AdvancedColorMetadata {
    supported: bool,
    enabled: bool,
    /// From DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO_2 (Windows 11 24H2 and later), which names HDR itself. The older
    /// query says "a type of advanced color": from Windows 11 22H2 that also covers a provisioned wide-gamut SDR panel
    /// under auto color management, so on those builds it can't tell WCG from HDR.
    hdr_only: bool,
}

/// DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO_2 as wingdi.h (Windows SDK 10.0.26100) declares it; windows 0.62 has no binding.
#[repr(C)]
#[derive(Clone, Copy)]
struct AdvancedColorInfo2 {
    header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
    value: u32,
    color_encoding: i32,
    bits_per_color_channel: u32,
    active_color_mode: i32,
}

const DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO_2: DISPLAYCONFIG_DEVICE_INFO_TYPE =
    DISPLAYCONFIG_DEVICE_INFO_TYPE(15);
const DISPLAYCONFIG_ADVANCED_COLOR_MODE_HDR: i32 = 2;

/// INFO_2's flags: bit 4 is highDynamicRangeSupported; the active mode is SDR, WCG or HDR.
fn advanced_color_from_info2(value: u32, active_color_mode: i32) -> AdvancedColorMetadata {
    let enabled = active_color_mode == DISPLAYCONFIG_ADVANCED_COLOR_MODE_HDR;
    AdvancedColorMetadata {
        supported: value & 0x10 != 0 || enabled,
        enabled,
        hdr_only: true,
    }
}

/// The older struct packs supported and enabled into bits 0 and 1; bit 3 is force-disabled.
/// Keep support independent of enabled.
fn advanced_color_from_info(value: u32) -> AdvancedColorMetadata {
    AdvancedColorMetadata {
        supported: value & 0x1 != 0,
        enabled: value & 0x2 != 0,
        hdr_only: false,
    }
}

/// What QueryDisplayConfig adds to the GDI monitor list, by GDI device name.
#[derive(Debug, Clone, Copy, Default)]
struct DisplayConfigFacts {
    color: Option<AdvancedColorMetadata>,
    refresh_rate: Option<DISPLAYCONFIG_RATIONAL>,
}

/// The refresh rate the monitor runs at, 0 when Windows reports none. QueryDisplayConfig's exact rate comes
/// first (119.88 Hz, where DEVMODE says 119); a 0 or 1 from either source means "hardware default", not a rate.
fn refresh_rate(exact: Option<DISPLAYCONFIG_RATIONAL>, display_frequency: Option<u32>) -> f64 {
    let exact = exact
        .filter(|rate| rate.Denominator != 0)
        // Two decimals, as Windows names rates: 119.88 stays, a 143.9997 Hz timing is 144.
        .map(|rate| {
            (f64::from(rate.Numerator) / f64::from(rate.Denominator) * 100.0).round() / 100.0
        });
    exact
        .into_iter()
        .chain(display_frequency.map(f64::from))
        .find(|hz| hz.is_finite() && *hz > 1.0)
        .unwrap_or(0.0)
}

#[derive(Debug, Clone, Copy, Default)]
struct DxgiColorMetadata {
    hdr_color_space: bool,
    peak_nits: Option<f32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct MonitorColorMetadata {
    hdr_supported: bool,
    hdr_on: bool,
    peak_nits: Option<f32>,
}

fn combine_monitor_color(
    advanced: Option<AdvancedColorMetadata>,
    dxgi: Option<DxgiColorMetadata>,
) -> MonitorColorMetadata {
    let dxgi_color = dxgi.unwrap_or_default();
    let (hdr_supported, hdr_on) = match advanced.unwrap_or_default() {
        advanced if advanced.hdr_only => (advanced.supported, advanced.enabled),
        advanced => (
            advanced.supported || dxgi_color.hdr_color_space,
            // Prefer DXGI's current color space when available: advanced color can also be WCG.
            dxgi.map_or(advanced.enabled, |color| color.hdr_color_space),
        ),
    };
    MonitorColorMetadata {
        hdr_supported,
        hdr_on,
        peak_nits: dxgi_color
            .peak_nits
            .filter(|value| value.is_finite() && *value > 0.0),
    }
}

#[derive(Debug)]
struct NativeMonitor {
    handle: HMONITOR,
    bounds: MonitorBounds,
    device_name: [u16; 32],
    primary: bool,
}

fn wide_string(value: &[u16]) -> String {
    let end = value
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end])
}

unsafe extern "system" fn collect_monitor(
    handle: HMONITOR,
    _dc: HDC,
    _clip: *mut windows::Win32::Foundation::RECT,
    data: LPARAM,
) -> windows::core::BOOL {
    let monitors = &mut *(data.0 as *mut Vec<NativeMonitor>);
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if !GetMonitorInfoW(handle, &mut info.monitorInfo).as_bool() {
        return windows::core::BOOL(1);
    }
    let bounds = info.monitorInfo.rcMonitor;
    monitors.push(NativeMonitor {
        handle,
        bounds: MonitorBounds {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
        },
        device_name: info.szDevice,
        primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
    });
    windows::core::BOOL(1)
}

fn enumerate_native_monitors() -> Result<Vec<NativeMonitor>> {
    let mut monitors = Vec::new();
    // SAFETY: EnumDisplayMonitors invokes the callback synchronously and the LPARAM points
    // to the live vector for that call. The callback only reads monitor metadata.
    let enumerated = unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(collect_monitor),
            LPARAM(&mut monitors as *mut Vec<NativeMonitor> as isize),
        )
    };
    if !enumerated.as_bool() {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            "Windows could not enumerate display monitors.",
            None,
        ));
    }
    Ok(monitors)
}

fn current_display_mode(device_name: &str) -> Option<DEVMODEW> {
    let mut mode = DEVMODEW::default();
    mode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
    let device_name: Vec<u16> = device_name.encode_utf16().chain(Some(0)).collect();
    // SAFETY: the NUL-terminated device name and initialized DEVMODEW stay alive for the call.
    unsafe {
        EnumDisplaySettingsW(
            windows::core::PCWSTR(device_name.as_ptr()),
            ENUM_CURRENT_SETTINGS,
            &mut mode,
        )
        .as_bool()
        .then_some(mode)
    }
}

fn dxgi_reports_hdr_color_space(
    color_space: windows::Win32::Graphics::Dxgi::Common::DXGI_COLOR_SPACE_TYPE,
) -> bool {
    matches!(
        color_space,
        DXGI_COLOR_SPACE_RGB_FULL_G10_NONE_P709
            | DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020
            | DXGI_COLOR_SPACE_RGB_STUDIO_G2084_NONE_P2020
    )
}

fn dxgi_monitor_colors() -> Vec<(HMONITOR, DxgiColorMetadata)> {
    // DXGI is supplementary: GDI monitor enumeration remains useful on drivers that do not
    // expose output6 or fail a color-description query.
    let factory: IDXGIFactory1 = match unsafe { CreateDXGIFactory1() } {
        Ok(factory) => factory,
        Err(_) => return Vec::new(),
    };
    let mut result = Vec::new();
    unsafe {
        for adapter_index in 0.. {
            let adapter = match factory.EnumAdapters1(adapter_index) {
                Ok(adapter) => adapter,
                Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                // Keep the GDI facts already collected, and stop if a driver reports an
                // unexpected adapter error. Continuing could otherwise scan to u32 exhaustion.
                Err(_) => break,
            };
            for output_index in 0.. {
                let output = match adapter.EnumOutputs(output_index) {
                    Ok(output) => output,
                    Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                    // DXGI is supplemental; stop this adapter's output scan on unexpected
                    // errors rather than potentially looping through every u32 index.
                    Err(_) => break,
                };
                let Ok(output6) = output.cast::<IDXGIOutput6>() else {
                    continue;
                };
                let Ok(desc) = output6.GetDesc1() else {
                    continue;
                };
                if !desc.AttachedToDesktop.as_bool() {
                    continue;
                }
                result.push((
                    desc.Monitor,
                    DxgiColorMetadata {
                        hdr_color_space: dxgi_reports_hdr_color_space(desc.ColorSpace),
                        peak_nits: (desc.MaxLuminance.is_finite() && desc.MaxLuminance > 0.0)
                            .then_some(desc.MaxLuminance),
                    },
                ));
            }
        }
    }
    result
}

fn display_config_facts() -> HashMap<String, DisplayConfigFacts> {
    let mut path_count = 0;
    let mut mode_count = 0;
    let mut result = HashMap::<String, DisplayConfigFacts>::new();
    // SAFETY: query buffers are sized by GetDisplayConfigBufferSizes and remain alive through
    // both query calls. Device-info headers point at properly sized Windows API structs.
    unsafe {
        for _ in 0..3 {
            if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
                .0
                != 0
                || path_count == 0
            {
                return result;
            }
            let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
            let mut modes = vec![
                windows::Win32::Devices::Display::DISPLAYCONFIG_MODE_INFO::default(
                );
                mode_count.max(1) as usize
            ];
            let query_result = QueryDisplayConfig(
                QDC_ONLY_ACTIVE_PATHS,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                None,
            );
            if query_result == ERROR_INSUFFICIENT_BUFFER {
                continue;
            }
            if query_result.0 != 0 {
                return result;
            }
            paths.truncate(path_count as usize);

            for path in paths {
                let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME {
                    header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                        r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
                        size: std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32,
                        adapterId: path.sourceInfo.adapterId,
                        id: path.sourceInfo.id,
                    },
                    ..Default::default()
                };
                if DisplayConfigGetDeviceInfo(&mut source.header) != 0 {
                    continue;
                }
                let facts = result
                    .entry(wide_string(&source.viewGdiDeviceName))
                    .or_default();
                if facts.refresh_rate.is_none() {
                    facts.refresh_rate = Some(path.targetInfo.refreshRate);
                }
                let header = |kind, size| DISPLAYCONFIG_DEVICE_INFO_HEADER {
                    r#type: kind,
                    size,
                    adapterId: path.targetInfo.adapterId,
                    id: path.targetInfo.id,
                };
                let mut color2 = AdvancedColorInfo2 {
                    header: header(
                        DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO_2,
                        std::mem::size_of::<AdvancedColorInfo2>() as u32,
                    ),
                    value: 0,
                    color_encoding: 0,
                    bits_per_color_channel: 0,
                    active_color_mode: 0,
                };
                let mut color = DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO {
                    header: header(
                        DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO,
                        std::mem::size_of::<DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO>() as u32,
                    ),
                    ..Default::default()
                };
                // Builds before Windows 11 24H2 refuse INFO_2, so they fall back to the older query.
                let advanced =
                    if DisplayConfigGetDeviceInfo((&mut color2 as *mut AdvancedColorInfo2).cast())
                        == 0
                    {
                        advanced_color_from_info2(color2.value, color2.active_color_mode)
                    } else if DisplayConfigGetDeviceInfo(&mut color.header) == 0 {
                        advanced_color_from_info(color.Anonymous.value)
                    } else {
                        continue;
                    };
                // One GDI device can drive several targets (cloned displays): any of them counts.
                let current = facts.color.get_or_insert_default();
                current.supported |= advanced.supported;
                current.enabled |= advanced.enabled;
                current.hdr_only |= advanced.hdr_only;
            }
            return result;
        }
    }
    result
}

struct MonitorDpiContext {
    previous: windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT,
}

impl MonitorDpiContext {
    fn enter() -> Option<Self> {
        // Per-monitor awareness keeps GDI monitor coordinates in physical pixels regardless
        // of which Tauri worker thread executes this command. Windows 10 1607 supports V1;
        // V2 is preferred when available.
        unsafe {
            let previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            if !previous.0.is_null() {
                return Some(Self { previous });
            }

            let previous = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE);
            (!previous.0.is_null()).then_some(Self { previous })
        }
    }
}

impl Drop for MonitorDpiContext {
    fn drop(&mut self) {
        // SAFETY: `previous` is the valid context returned by the successful enter call.
        unsafe {
            SetThreadDpiAwarenessContext(self.previous);
        }
    }
}

/// Enumerates physical desktop monitors and current color metadata for the TypeScript core.
pub fn monitors() -> Result<Vec<MonitorInfo>> {
    let _dpi_context = MonitorDpiContext::enter().ok_or_else(|| {
        PlatformError::new(
            ErrorKind::Unknown,
            "Windows could not establish per-monitor DPI awareness for monitor enumeration.",
            None,
        )
    })?;
    let native_monitors = enumerate_native_monitors()?;
    let display_config = display_config_facts();
    let dxgi = dxgi_monitor_colors();
    Ok(native_monitors
        .into_iter()
        .map(|native| {
            let device_name = wide_string(&native.device_name);
            let mode = current_display_mode(&device_name);
            let bounds_width = native
                .bounds
                .right
                .saturating_sub(native.bounds.left)
                .max(0) as u32;
            let bounds_height = native
                .bounds
                .bottom
                .saturating_sub(native.bounds.top)
                .max(0) as u32;
            let width = mode.as_ref().map_or(bounds_width, |mode| {
                if mode.dmPelsWidth > 0 {
                    mode.dmPelsWidth
                } else {
                    bounds_width
                }
            });
            let height = mode.as_ref().map_or(bounds_height, |mode| {
                if mode.dmPelsHeight > 0 {
                    mode.dmPelsHeight
                } else {
                    bounds_height
                }
            });
            let facts = display_config
                .get(&device_name)
                .copied()
                .unwrap_or_default();
            let refresh_hz = refresh_rate(
                facts.refresh_rate,
                mode.as_ref().map(|mode| mode.dmDisplayFrequency),
            );
            let advanced = facts.color;
            let dxgi_color = dxgi
                .iter()
                .find(|(handle, _)| *handle == native.handle)
                .map(|(_, color)| *color);
            let color = combine_monitor_color(advanced, dxgi_color);
            MonitorInfo {
                device_name,
                bounds: native.bounds,
                primary: native.primary,
                refresh_hz,
                width,
                height,
                hdr_supported: color.hdr_supported,
                hdr_on: color.hdr_on,
                peak_nits: color.peak_nits,
            }
        })
        .collect())
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
    /// Where Windows ranks this adapter for high performance, 0 first: external, then discrete, then
    /// integrated GPUs. Absent when Windows can't rank adapters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub high_performance_rank: Option<u32>,
}

/// Adapter LUIDs in DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE order; empty without IDXGIFactory6 (Windows 10 1803).
fn high_performance_order(factory: &IDXGIFactory1) -> Vec<LUID> {
    let mut order = Vec::new();
    // SAFETY: the bindings manage the COM interfaces' lifetimes; GetDesc1 returns an owned descriptor.
    unsafe {
        let Ok(factory) = factory.cast::<IDXGIFactory6>() else {
            return order;
        };
        for index in 0.. {
            // The ranking is supplementary: any error, DXGI_ERROR_NOT_FOUND included, ends it.
            let Ok(adapter) = factory.EnumAdapterByGpuPreference::<IDXGIAdapter1>(
                index,
                DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE,
            ) else {
                break;
            };
            if let Ok(desc) = adapter.GetDesc1() {
                order.push(desc.AdapterLuid);
            }
        }
    }
    order
}

/// Enumerates DXGI adapters. Choice and tier matching belong to the TypeScript core.
pub fn gpu_adapters() -> Result<Vec<GpuAdapter>> {
    let error =
        |e: windows::core::Error| PlatformError::new(ErrorKind::Unknown, e.to_string(), None);
    // SAFETY: the bindings manage the COM interfaces' lifetimes. GetDesc1 returns an owned descriptor;
    // no raw pointer or interface leaves this thread.
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().map_err(error)?;
        let ranking = high_performance_order(&factory);
        let mut adapters = Vec::new();
        for index in 0.. {
            let adapter = match factory.EnumAdapters1(index) {
                Ok(adapter) => adapter,
                Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
                Err(e) => return Err(error(e)),
            };
            let desc = adapter.GetDesc1().map_err(error)?;
            let len = desc
                .Description
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(desc.Description.len());
            // DXGI reports the user-mode driver version as four packed 16-bit values.
            // This query is optional: an adapter that does not support it must still be listed.
            let driver_version =
                adapter
                    .CheckInterfaceSupport(&IDXGIDevice::IID)
                    .ok()
                    .map(|version| {
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
                high_performance_rank: ranking
                    .iter()
                    .position(|luid| *luid == desc.AdapterLuid)
                    .map(|rank| rank as u32),
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
    let build_value: String = key
        .get_value("CurrentBuildNumber")
        .map_err(|e| PlatformError::io(e, None))?;
    let build = build_value.parse::<u32>().map_err(|e| {
        PlatformError::new(
            ErrorKind::Unknown,
            format!("Invalid Windows build number: {e}"),
            None,
        )
    })?;
    let display_version: String = key
        .get_value("DisplayVersion")
        .map_err(|e| PlatformError::io(e, None))?;
    let ubr: u32 = key
        .get_value("UBR")
        .map_err(|e| PlatformError::io(e, None))?;
    let family = if build >= 22_000 {
        "Windows 11"
    } else {
        "Windows 10"
    };

    Ok(format!("{family} {display_version} (build {build}.{ubr})"))
}

/// Builds the lParam consumed by GetKeyNameTextW from a virtual key and MapVirtualKeyEx scan code.
fn key_name_lparam(virtual_key: u32, scan_code: u32) -> i32 {
    let scan = (scan_code & 0xff) << 16;
    // MapVirtualKeyEx sometimes returns the keypad scan code for extended virtual keys such as
    // VK_DELETE. GetKeyNameText still needs bit 24 to distinguish the main Delete key from Num Del.
    let extended_key =
        matches!(virtual_key, 0x21..=0x28 | 0x2c..=0x2f | 0x5b..=0x5d | 0x90..=0x92 | 0xa3 | 0xa5);
    let extended = if scan_code & 0xff00 == 0xe000 || extended_key {
        1 << 24
    } else {
        0
    };
    const DO_NOT_CARE_LEFT_RIGHT: u32 = 1 << 25;
    (scan | extended | DO_NOT_CARE_LEFT_RIGHT) as i32
}

/// The keyboard layout belongs to the foreground window's thread, not the Tauri command worker.
fn foreground_keyboard_layout() -> Option<HKL> {
    // SAFETY: these calls only read the foreground window and its thread's input locale.
    unsafe {
        let window = GetForegroundWindow();
        if window.is_invalid() {
            return None;
        }
        let thread_id = GetWindowThreadProcessId(window, None);
        if thread_id == 0 {
            return None;
        }
        let layout = GetKeyboardLayout(thread_id);
        (!layout.is_invalid()).then_some(layout)
    }
}

/// GetKeyNameTextW reads the calling thread's active layout, so switch this worker thread only.
struct KeyboardLayoutGuard(HKL);

impl KeyboardLayoutGuard {
    fn activate(layout: HKL) -> Option<Self> {
        // SAFETY: the previous layout is restored when the guard drops. Flags are zero, so
        // ActivateKeyboardLayout changes only this worker thread and sends no process-wide change.
        unsafe {
            let previous = GetKeyboardLayout(0);
            ActivateKeyboardLayout(layout, ACTIVATE_KEYBOARD_LAYOUT_FLAGS(0))
                .ok()
                .map(|_| Self(previous))
        }
    }
}

impl Drop for KeyboardLayoutGuard {
    fn drop(&mut self) {
        // SAFETY: `previous` was returned by GetKeyboardLayout on this same thread.
        unsafe {
            let _ = ActivateKeyboardLayout(self.0, ACTIVATE_KEYBOARD_LAYOUT_FLAGS(0));
        }
    }
}

/// Names virtual keys with the foreground window's keyboard layout. Unknown keys have no entry.
fn key_names_for_layout(virtual_keys: &[u32], layout: HKL) -> HashMap<u32, String> {
    let Some(_layout_guard) = KeyboardLayoutGuard::activate(layout) else {
        return HashMap::new();
    };
    virtual_keys
        .iter()
        .copied()
        .filter(|key| *key <= 0xff)
        .filter_map(|key| {
            // SAFETY: MapVirtualKeyExW and GetKeyNameTextW receive a valid layout and an owned buffer.
            let name = unsafe {
                let scan_code = MapVirtualKeyExW(key, MAPVK_VK_TO_VSC_EX, Some(layout));
                if scan_code == 0 {
                    return None;
                }
                let mut buffer = [0u16; 128];
                let length = GetKeyNameTextW(key_name_lparam(key, scan_code), &mut buffer);
                if length <= 0 {
                    return None;
                }
                String::from_utf16_lossy(&buffer[..length as usize])
                    .trim()
                    .to_owned()
            };
            (!name.is_empty() && !name.chars().any(char::is_control)).then_some((key, name))
        })
        .collect()
}

/// Names virtual keys with the foreground window's keyboard layout. Unknown keys have no entry.
pub fn key_names(virtual_keys: &[u32]) -> HashMap<u32, String> {
    foreground_keyboard_layout()
        .map(|layout| key_names_for_layout(virtual_keys, layout))
        .unwrap_or_default()
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
                return Err(PlatformError::new(
                    ErrorKind::Unknown,
                    "Windows could not lock clipboard memory",
                    None,
                ));
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
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            "URL contains an embedded NUL",
            None,
        ));
    }
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| PlatformError::new(ErrorKind::Unknown, format!("Invalid URL: {e}"), None))?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            "Only HTTPS URLs can be opened",
            None,
        ));
    }
    let target = HSTRING::from(parsed.as_str());
    let operation = HSTRING::from("open");

    // SAFETY: the HSTRING values stay alive for the call and `owner` is Tauri's live window.
    let result =
        unsafe { ShellExecuteW(Some(owner), &operation, &target, None, None, SW_SHOWNORMAL) };
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

/// Asks Steam to start a game by its app id, as a Steam library "Play" would.
pub fn open_steam_game(app_id: u32, owner: HWND) -> Result<()> {
    let target = HSTRING::from(format!("steam://rungameid/{app_id}"));
    let operation = HSTRING::from("open");
    // SAFETY: the HSTRING values stay alive for the call and `owner` is Tauri's live window.
    let result =
        unsafe { ShellExecuteW(Some(owner), &operation, &target, None, None, SW_SHOWNORMAL) };
    let code = result.0 as usize;
    if code <= 32 {
        return Err(PlatformError::new(
            ErrorKind::NotFound,
            format!("Steam didn't start the game (ShellExecuteW error {code})"),
            None,
        ));
    }
    Ok(())
}

/// Shows a folder in File Explorer. The validated folder is the shell's file, with no parameters: nothing here builds
/// a command line or hands Explorer arguments to parse.
pub fn open_folder(path: &str, owner: HWND) -> Result<()> {
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    let folder = crate::files::validate_open_folder(path)?;
    let target = HSTRING::from(folder.as_os_str());
    let operation = HSTRING::from("open");
    // SAFETY: the HSTRING values stay alive for the call and `owner` is Tauri's live window. The folder's open verb is
    // a COM handler, so COM is initialized as the shell asks, and uninitialized only if this call initialized it.
    let result = unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        if initialized.is_err() && initialized != RPC_E_CHANGED_MODE {
            return Err(PlatformError::new(
                ErrorKind::Unknown,
                initialized.to_string(),
                Some(&folder),
            ));
        }
        let result = ShellExecuteW(Some(owner), &operation, &target, None, None, SW_SHOWNORMAL);
        if initialized.is_ok() {
            CoUninitialize();
        }
        result
    };
    let code = result.0 as usize;
    if code <= 32 {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            format!("Windows could not open the folder (ShellExecuteW error {code})"),
            Some(&folder),
        ));
    }
    Ok(())
}

/// Starts a program from its own folder without waiting for it; unlike `launch_exe`, Lucent keeps running.
pub fn start_program(path: &Path) -> Result<()> {
    let mut command = std::process::Command::new(path);
    if let Some(folder) = path.parent() {
        command.current_dir(folder);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| PlatformError::io(e, Some(path)))
}

fn win32_error(error: windows::core::Error) -> PlatformError {
    PlatformError::new(ErrorKind::Unknown, error.to_string(), None)
}

/// As many redirects as reqwest's default policy follows.
const MAX_REDIRECTS: usize = 10;

const HELIOSPHERE_REFUSED: &str = "Heliosphere doesn’t allow other programs to download from it.";

/// Heliosphere's terms bar other programs from its endpoints, so nothing on heliosphere.app or under it is fetched,
/// however the host is spelt (`Repo.Heliosphere.App.`).
fn is_heliosphere(url: &reqwest::Url) -> bool {
    url.host_str().is_some_and(|host| {
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        host == "heliosphere.app" || host.ends_with(".heliosphere.app")
    })
}

/// Why a redirect to `next` must not be followed, `hops` being the addresses already visited, first one included.
fn redirect_refusal(next: &reqwest::Url, hops: usize) -> Option<&'static str> {
    if hops > MAX_REDIRECTS {
        Some("The server redirected Lucent too many times.")
    } else if next.scheme() != "https" {
        Some("The server redirected Lucent to an address that doesn’t use HTTPS.")
    } else if is_heliosphere(next) {
        Some(HELIOSPHERE_REFUSED)
    } else {
        None
    }
}

/// Checks every hop of every request. The first address is checked by `fetchable_url` before the request is sent.
pub(crate) fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        // An error, never `stop`: a stopped redirect hands back its 3xx response, which error_for_status lets through.
        match redirect_refusal(attempt.url(), attempt.previous().len()) {
            Some(why) => attempt.error(why),
            None => attempt.follow(),
        }
    })
}

/// Parses an address to fetch, refusing Heliosphere. The core requires HTTPS for the first address itself.
pub(crate) fn fetchable_url(url: &str) -> Result<reqwest::Url> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| PlatformError::new(ErrorKind::Unknown, format!("Invalid URL: {e}"), None))?;
    if is_heliosphere(&parsed) {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            HELIOSPHERE_REFUSED,
            None,
        ));
    }
    Ok(parsed)
}

/// A redirect the policy refused, with its reason. It is not the network's fault, so the core must not retry it.
pub(crate) fn refused_redirect(error: &reqwest::Error) -> Option<PlatformError> {
    use std::error::Error;
    error
        .is_redirect()
        .then(|| error.source())
        .flatten()
        .map(|why| PlatformError::new(ErrorKind::Unknown, why.to_string(), None))
}

/// The most text `fetch_text` reads. GitHub's releases list is about 2 MB and the manifest 1.6 MB, both growing
/// with every content version; a cap they outgrew would stop every installed app from hearing of updates.
const MAX_TEXT_BYTES: u64 = 32 * 1024 * 1024;

/// Fetches text with a bounded wait and size. HTTP error bodies must never be parsed as manifests.
pub async fn fetch_text(url: &str) -> Result<String> {
    fetch_text_limited(url, MAX_TEXT_BYTES).await
}

async fn fetch_text_limited(url: &str, max_bytes: u64) -> Result<String> {
    let error = |e: reqwest::Error| {
        refused_redirect(&e)
            .unwrap_or_else(|| PlatformError::new(ErrorKind::Network, e.to_string(), None))
    };
    let too_large = || {
        PlatformError::new(
            ErrorKind::Unknown,
            format!(
                "The server sent more than {} MB.",
                max_bytes.div_ceil(1024 * 1024)
            ),
            None,
        )
    };
    let url = fetchable_url(url)?;
    // The update check reads the releases list and the manifest at once: 3.5 MB, about 0.4 MB gzipped.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .gzip(true)
        .redirect(redirect_policy())
        .user_agent(concat!("Lucent/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(error)?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(error)?
        .error_for_status()
        .map_err(error)?;
    // A gzipped reply has no usable length, so the running count is the real limit.
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        return Err(too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(error)? {
        if (body.len() + chunk.len()) as u64 > max_bytes {
            return Err(too_large());
        }
        body.extend_from_slice(&chunk);
    }
    // As reqwest's `text()` without its charset feature: bytes that aren't UTF-8 become U+FFFD.
    Ok(String::from_utf8_lossy(&body).into_owned())
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
    let Some(manifest) = std::env::var_os("LUCENT_DEV_MANIFEST") else {
        return Ok(None);
    };
    let manifest = std::path::absolute(manifest).map_err(|e| PlatformError::io(e, None))?;
    let files = match std::env::var_os("LUCENT_DEV_FILES") {
        Some(path) => std::path::absolute(path).map_err(|e| PlatformError::io(e, None))?,
        None => manifest
            .parent()
            .ok_or_else(|| {
                PlatformError::new(
                    ErrorKind::Unknown,
                    "The dev manifest must name a file",
                    None,
                )
            })?
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
    if let Some(resume) = elevation_resume_path() {
        command.arg("--lucent-resume").arg(resume);
    }
    command
        .spawn()
        .map_err(|e| PlatformError::io(e, Some(path)))?;
    std::process::exit(0)
}

/// A create/delete probe distinguishes access denial from a full disk or locked folder.
pub fn is_directory_writable(path: &Path) -> Result<bool> {
    if crate::files::is_game_running()? {
        return Err(PlatformError::new(
            ErrorKind::Locked,
            "Close XIV before changing the game folder.",
            Some(path),
        ));
    }
    match tempfile::Builder::new()
        .prefix(".lucent-access-")
        .tempfile_in(path)
    {
        Ok(file) => {
            file.close().map_err(|e| PlatformError::io(e, Some(path)))?;
            Ok(true)
        }
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => Ok(false),
        Err(e) => Err(PlatformError::io(e, Some(path))),
    }
}

/// Checks only the requested write targets and their existing parents, without modifying their bytes.
pub fn game_write_access(root: &Path, targets: &[String]) -> Result<bool> {
    use std::collections::BTreeSet;
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{DELETE, FILE_FLAG_BACKUP_SEMANTICS};
    if !is_directory_writable(root)? {
        return Ok(false);
    }
    let mut directories = BTreeSet::new();
    directories.insert(root.to_owned());
    for relative in targets {
        let path = crate::files::resolve_game_path(root, relative)?;
        match fs::metadata(&path) {
            Ok(meta) => {
                // Atomic replacement and removal need delete access to an existing target.
                match fs::OpenOptions::new()
                    .access_mode(DELETE.0)
                    .custom_flags(if meta.is_dir() {
                        FILE_FLAG_BACKUP_SEMANTICS.0
                    } else {
                        0
                    })
                    .open(&path)
                {
                    Ok(_) => {}
                    Err(e) if e.kind() == io::ErrorKind::PermissionDenied => return Ok(false),
                    Err(e) => return Err(PlatformError::io(e, Some(&path))),
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(PlatformError::io(e, Some(&path))),
        }
        let mut parent = path.parent();
        while let Some(directory) = parent {
            match fs::metadata(directory) {
                Ok(meta) if meta.is_dir() => {
                    if directories.insert(directory.to_owned())
                        && !is_directory_writable(directory)?
                    {
                        return Ok(false);
                    }
                    break;
                }
                Ok(_) => {
                    return Err(PlatformError::new(
                        ErrorKind::AccessDenied,
                        "A write target's parent is a file.",
                        Some(directory),
                    ))
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => parent = directory.parent(),
                Err(e) => return Err(PlatformError::io(e, Some(directory))),
            }
        }
    }
    Ok(true)
}

pub fn is_elevated() -> Result<bool> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    let error =
        |e: windows::core::Error| PlatformError::new(ErrorKind::Unknown, e.to_string(), None);
    // SAFETY: the token belongs to this process; the output buffer has the exact TOKEN_ELEVATION size.
    // Its handle is closed even when GetTokenInformation fails.
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(error)?;
        let mut elevation = TOKEN_ELEVATION::default();
        let mut size = 0;
        let result = GetTokenInformation(
            token,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        );
        let _ = CloseHandle(token);
        result.map_err(error)?;
        Ok(elevation.TokenIsElevated != 0)
    }
}

/// `uninstall` when Settings → Apps started Lucent as its own uninstaller (`--uninstall`);
/// `check` or `repair` when a XIVLauncher add-on started a headless run.
pub fn headless_mode() -> Option<&'static str> {
    headless_mode_from(std::env::args_os().skip(1))
}

fn headless_mode_from<I: IntoIterator<Item = std::ffi::OsString>>(args: I) -> Option<&'static str> {
    args.into_iter().find_map(|arg| match arg.to_str()? {
        "--headless-check" => Some("check"),
        "--headless-repair" => Some("repair"),
        "--uninstall" => Some("uninstall"),
        _ => None,
    })
}

const AUMID: &str = "io.github.arnaudcouturier.lucent";
const AUMID_KEY: &str = r"Software\Classes\AppUserModelId";

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Shows a Windows toast from Lucent. An unpackaged exe needs its AppUserModelID registered first.
pub fn notify(title: &str, body: &str) -> Result<()> {
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(format!(r"{AUMID_KEY}\{AUMID}"))
        .map_err(|e| PlatformError::io(e, None))?;
    key.set_value("DisplayName", &"Lucent")
        .map_err(|e| PlatformError::io(e, None))?;
    // Best effort: it only improves how Windows groups the toast with the app.
    // SAFETY: the HSTRING outlives the call.
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(AUMID));
    }
    let xml = format!(
        "<toast><visual><binding template=\"ToastText02\"><text id=\"1\">{}</text><text id=\"2\">{}</text></binding></visual></toast>",
        xml_escape(title), xml_escape(body),
    );
    let show = || -> windows::core::Result<()> {
        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID))?.Show(&toast)
    };
    show().map_err(win32_error)
}

pub fn elevation_resume_path() -> Option<String> {
    let mut args = std::env::args_os().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--lucent-resume" {
            return args.next().map(|path| path.to_string_lossy().into_owned());
        }
    }
    None
}

fn elevation_arguments(path: &Path) -> Result<String> {
    let path = path.to_str().ok_or_else(|| {
        PlatformError::new(
            ErrorKind::Unknown,
            "The resume path is not UTF-8.",
            Some(path),
        )
    })?;
    if path.contains(['"', '\0']) || !Path::new(path).is_absolute() || !path.ends_with(".json") {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            "Invalid administrator resume path.",
            Some(Path::new(path)),
        ));
    }
    let uninstall = if headless_mode() == Some("uninstall") {
        " --uninstall"
    } else {
        ""
    };
    Ok(format!("--lucent-resume \"{path}\"{uninstall}"))
}

/// Uses Windows UAC rather than a shell. Cancellation leaves the current app running.
pub fn request_elevation(resume_path: &Path) -> Result<()> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, RPC_E_CHANGED_MODE};
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let exe = wide(&exe_path()?);
    let args = wide(&elevation_arguments(resume_path)?);
    // SAFETY: all UTF-16 buffers stay alive until the synchronous shell call returns.
    // COM is uninitialized only if this call initialized it; the child-process handle is closed.
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if initialized.is_err() && initialized != RPC_E_CHANGED_MODE {
            return Err(PlatformError::new(
                ErrorKind::Unknown,
                initialized.to_string(),
                None,
            ));
        }
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOASYNC | SEE_MASK_NOCLOSEPROCESS,
            lpVerb: w!("runas"),
            lpFile: PCWSTR(exe.as_ptr()),
            lpParameters: PCWSTR(args.as_ptr()),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        let result = ShellExecuteExW(&mut info);
        if initialized.is_ok() {
            CoUninitialize();
        }
        result.map_err(|e| {
            let cancelled = e.code().0 as u32 & 0xffff == 1223;
            let message = if cancelled {
                "Administrator access was cancelled.".to_owned()
            } else {
                e.to_string()
            };
            PlatformError::new(
                if cancelled {
                    ErrorKind::Cancelled
                } else {
                    ErrorKind::AccessDenied
                },
                message,
                Some(resume_path),
            )
        })?;
        if !info.hProcess.is_invalid() {
            let _ = CloseHandle(info.hProcess);
        }
    }
    std::process::exit(0)
}

/// Creates or replaces a `.lnk` at `path` that starts `target`.
pub fn create_shortcut(path: &Path, target: &Path) -> Result<()> {
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| PlatformError::io(e, Some(parent)))?;
    }
    let target_directory = target.parent().ok_or_else(|| {
        PlatformError::new(
            ErrorKind::Unknown,
            "The shortcut target must name a file.",
            Some(target),
        )
    })?;
    let error =
        |e: windows::core::Error| PlatformError::new(ErrorKind::Unknown, e.to_string(), Some(path));
    // SAFETY: every HSTRING outlives the synchronous COM calls. COM is uninitialized only if this call
    // initialized it, after the shell link and file interfaces (dropped inside the closure) are released.
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if initialized.is_err() && initialized != RPC_E_CHANGED_MODE {
            return Err(PlatformError::new(
                ErrorKind::Unknown,
                initialized.to_string(),
                None,
            ));
        }
        let result = (|| {
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(error)?;
            link.SetPath(&HSTRING::from(target.as_os_str()))
                .map_err(error)?;
            link.SetWorkingDirectory(&HSTRING::from(target_directory.as_os_str()))
                .map_err(error)?;
            link.SetIconLocation(&HSTRING::from(target.as_os_str()), 0)
                .map_err(error)?;
            link.SetDescription(&HSTRING::from("Lucent"))
                .map_err(error)?;
            let file: IPersistFile = link.cast().map_err(error)?;
            file.Save(&HSTRING::from(path.as_os_str()), true)
                .map_err(error)
        })();
        if initialized.is_ok() {
            CoUninitialize();
        }
        result
    }
}

const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

fn uninstall_key_path(id: &str) -> Result<String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            format!("Invalid uninstall entry id {id:?}"),
            None,
        ));
    }
    Ok(format!(r"{UNINSTALL_KEY}\{id}"))
}

/// Creates the per-user Settings -> Apps entry `id`, or updates its values.
pub fn set_uninstall_entry(
    id: &str,
    values: &serde_json::Map<String, serde_json::Value>,
) -> Result<()> {
    let path = uninstall_key_path(id)?;
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(&path)
        .map_err(|e| PlatformError::io(e, None))?;
    for (name, value) in values {
        let written = match value {
            serde_json::Value::String(text) => key.set_value(name, text),
            serde_json::Value::Number(number) => {
                match number.as_u64().and_then(|n| u32::try_from(n).ok()) {
                    Some(n) => key.set_value(name, &n),
                    None => {
                        return Err(PlatformError::new(
                            ErrorKind::Unknown,
                            format!("Uninstall value {name} must be a 32-bit unsigned integer"),
                            None,
                        ))
                    }
                }
            }
            _ => {
                return Err(PlatformError::new(
                    ErrorKind::Unknown,
                    format!("Uninstall value {name} must be a string or number"),
                    None,
                ))
            }
        };
        written.map_err(|e| PlatformError::io(e, None))?;
    }
    Ok(())
}

/// Deletes the Settings -> Apps entry `id` and the toast registration `notify` makes; either one already gone is success.
pub fn remove_uninstall_entry(id: &str) -> Result<()> {
    remove_registration(id, AUMID)
}

fn remove_registration(id: &str, aumid: &str) -> Result<()> {
    let path = uninstall_key_path(id)?;
    delete_user_key(&path)?;
    // Only toasts read it, so a key that won't go must not stop an uninstall.
    let _ = delete_user_key(&format!(r"{AUMID_KEY}\{aumid}"));
    Ok(())
}

fn delete_user_key(path: &str) -> Result<()> {
    match RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(PlatformError::io(e, None)),
    }
}

/// Characters cmd could expand (`%`, and `!` should delayed expansion be on) or end a quoted path on.
fn unsafe_in_script(text: &str) -> bool {
    text.chars()
        .any(|c| matches!(c, '"' | '%' | '!') || c.is_control())
}

fn validate_removal_folder(folder: &Path, named_lucent: bool) -> Result<()> {
    use std::path::Component;
    let invalid = |why: &str| {
        PlatformError::new(
            ErrorKind::Unknown,
            format!("Refusing to remove this folder: {why}."),
            Some(folder),
        )
    };
    let text = folder
        .to_str()
        .ok_or_else(|| invalid("the path is not UTF-8"))?;
    if unsafe_in_script(text) {
        return Err(invalid("the path has unsafe characters"));
    }
    if !folder.is_absolute() {
        return Err(invalid("the path is not absolute"));
    }
    let mut names = 0;
    for component in folder.components() {
        match component {
            Component::Normal(_) => names += 1,
            Component::ParentDir | Component::CurDir => {
                return Err(invalid("the path is not normalized"))
            }
            _ => {}
        }
    }
    if names < 3 {
        return Err(invalid("the path is too short"));
    }
    let last = folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    if named_lucent && !last.eq_ignore_ascii_case("Lucent") {
        return Err(invalid("it is not a Lucent folder"));
    }
    Ok(())
}

fn build_removal_script(system32: &Path, folders: &[PathBuf], extra: &[PathBuf]) -> Result<String> {
    for folder in folders {
        validate_removal_folder(folder, true)?;
    }
    for folder in extra {
        validate_removal_folder(folder, false)?;
    }
    let all: Vec<&PathBuf> = folders.iter().chain(extra).collect();
    if all.is_empty() {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            "No folders to remove.",
            None,
        ));
    }
    // WebView2 child processes can hold files briefly after exit, so wait, then retry in rounds.
    let wait = format!(
        "\"{}\" -n 3 127.0.0.1 >nul",
        system32.join("ping.exe").display()
    );
    let mut steps = vec![wait.clone()];
    for round in 0..3 {
        if round > 0 {
            steps.push(wait.clone());
        }
        for folder in &all {
            steps.push(format!("rmdir /s /q \"{}\" 2>nul", folder.display()));
        }
    }
    Ok(steps.join(" & "))
}

/// Windows' System32. The removal script names its programs there: run from a folder other programs can write to,
/// cmd would prefer a planted `ping.com` beside it to the real `ping`.
fn system32() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .filter(|root| {
            root.is_absolute() && root.to_str().is_some_and(|text| !unsafe_in_script(text))
        })
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
}

fn removal_command(system32: &Path, script: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    // A hidden console, not DETACHED_PROCESS: without a console, each `ping` would open a visible one.
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut command = std::process::Command::new(system32.join("cmd.exe"));
    // /d skips AutoRun commands and /v:off keeps `!` literal, whatever the registry enables.
    command
        .raw_arg(format!("/d /v:off /c \"{script}\""))
        .current_dir(system32)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    command
}

/// Spawns a hidden `cmd.exe` that deletes `folders` (plus `extra`, such as the WebView2 data folder)
/// once this process has ended, then exits. Nothing is spawned if any folder is invalid.
pub fn exit_and_remove(folders: &[PathBuf], extra: &[PathBuf]) -> Result<()> {
    let system32 = system32();
    let script = build_removal_script(&system32, folders, extra)?;
    removal_command(&system32, &script)
        .spawn()
        .map_err(|e| PlatformError::io(e, None))?;
    std::process::exit(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyboardLayoutList;

    #[test]
    fn key_name_lparam_marks_extended_scan_codes() {
        for (virtual_key, scan_code) in [
            (0x2d, 0x0052), // Insert
            (0x2e, 0x0053), // Delete
            (0x24, 0x0047), // Home
            (0x21, 0x0049), // Page Up
            (0x22, 0x0051), // Page Down
            (0x23, 0x004f), // End
            (0x25, 0x004b), // Left
            (0x26, 0x0048), // Up
            (0x27, 0x004d), // Right
            (0x28, 0x0050), // Down
            (0x2c, 0xe037), // Print Screen
        ] {
            let lparam = key_name_lparam(virtual_key, scan_code);
            assert_eq!(((lparam as u32) >> 16) & 0xff, scan_code & 0xff);
            assert_eq!(
                ((lparam as u32) >> 24) & 1,
                1,
                "virtual key {virtual_key:#04x}"
            );
            assert_eq!(((lparam as u32) >> 25) & 1, 1);
        }

        let regular = key_name_lparam(0x41, 0x001e);
        assert_eq!(((regular as u32) >> 16) & 0xff, 0x1e);
        assert_eq!(((regular as u32) >> 24) & 1, 0);
        assert_eq!(((regular as u32) >> 25) & 1, 1);
    }

    #[test]
    fn keyboard_layout_guard_restores_the_worker_thread_layout() {
        // The scope only changes this Rust test thread; it does not activate a layout for the process.
        let original = unsafe { GetKeyboardLayout(0) };
        let count = unsafe { GetKeyboardLayoutList(None) };
        if count <= 0 {
            return;
        }
        let mut layouts = vec![original; count as usize];
        let copied = unsafe { GetKeyboardLayoutList(Some(&mut layouts)) };
        let target = layouts
            .into_iter()
            .take(copied.max(0) as usize)
            .find(|layout| *layout != original)
            .unwrap_or(original);

        let guard = KeyboardLayoutGuard::activate(target)
            .expect("the loaded layout should activate on this thread");
        assert_eq!(unsafe { GetKeyboardLayout(0) }, target);
        drop(guard);
        assert_eq!(unsafe { GetKeyboardLayout(0) }, original);
    }

    #[test]
    fn key_names_follow_the_requested_layout_when_the_worker_uses_another_layout() {
        let count = unsafe { GetKeyboardLayoutList(None) };
        if count <= 0 {
            return;
        }
        let mut layouts = vec![unsafe { GetKeyboardLayout(0) }; count as usize];
        let copied = unsafe { GetKeyboardLayoutList(Some(&mut layouts)) };
        let layouts = layouts.into_iter().take(copied.max(0) as usize);
        let mut us = None;
        let mut french = None;
        for layout in layouts {
            match (layout.0 as usize) & 0xffff {
                0x0409 => us = Some(layout),
                0x040c => french = Some(layout),
                _ => {}
            }
        }
        let (Some(us), Some(french)) = (us, french) else {
            // CI machines do not necessarily have both layouts installed.
            return;
        };

        let original = unsafe { GetKeyboardLayout(0) };
        let us_names = key_names_for_layout(&[0x2e, 0xdc], us);
        let french_names = key_names_for_layout(&[0x2e, 0xdc], french);
        assert_eq!(unsafe { GetKeyboardLayout(0) }, original);
        assert!(us_names.get(&0x2e).is_some_and(|name| !name.is_empty()));
        assert!(french_names.get(&0x2e).is_some_and(|name| !name.is_empty()));
        assert_ne!(us_names.get(&0xdc), french_names.get(&0xdc));
    }

    #[test]
    fn monitor_metadata_serializes_the_public_camel_case_shape() {
        let mut monitor = MonitorInfo {
            device_name: r"\\.\DISPLAY1".into(),
            bounds: MonitorBounds {
                left: 0,
                top: 0,
                right: 2560,
                bottom: 1440,
            },
            primary: true,
            refresh_hz: 240.0,
            width: 2560,
            height: 1440,
            hdr_supported: true,
            hdr_on: false,
            peak_nits: Some(1000.0),
        };

        assert_eq!(
            serde_json::to_value(&monitor).unwrap(),
            serde_json::json!({
                "deviceName": r"\\.\DISPLAY1",
                "bounds": { "left": 0, "top": 0, "right": 2560, "bottom": 1440 },
                "primary": true,
                "refreshHz": 240.0,
                "width": 2560,
                "height": 1440,
                "hdrSupported": true,
                "hdrOn": false,
                "peakNits": 1000.0
            })
        );
        monitor.peak_nits = None;
        assert_eq!(
            serde_json::to_value(monitor).unwrap()["peakNits"],
            serde_json::Value::Null
        );
    }

    #[test]
    fn advanced_color_capability_survives_hdr_being_off() {
        // The older query on a build without INFO_2: "a type of advanced color" counts as HDR support.
        let color = combine_monitor_color(
            Some(AdvancedColorMetadata {
                supported: true,
                enabled: true,
                hdr_only: false,
            }),
            Some(DxgiColorMetadata {
                hdr_color_space: false,
                peak_nits: Some(600.0),
            }),
        );

        assert_eq!(
            color,
            MonitorColorMetadata {
                hdr_supported: true,
                hdr_on: false,
                peak_nits: Some(600.0),
            }
        );
    }

    #[test]
    fn dxgi_hdr_color_space_reports_hdr_active_without_display_config() {
        assert_eq!(
            combine_monitor_color(
                None,
                Some(DxgiColorMetadata {
                    hdr_color_space: true,
                    peak_nits: None,
                }),
            ),
            MonitorColorMetadata {
                hdr_supported: true,
                hdr_on: true,
                peak_nits: None,
            }
        );
    }

    #[test]
    fn info2_tells_an_hdr_monitor_from_a_wide_gamut_sdr_panel() {
        // wingdi.h: a 20-byte header, the flags, the color encoding, the bits per channel and the active mode.
        assert_eq!(std::mem::size_of::<AdvancedColorInfo2>(), 36);
        const SUPPORTED: u32 = 0x1;
        const ACTIVE: u32 = 0x2;
        const HDR_SUPPORTED: u32 = 0x10;
        const HDR_USER_ENABLED: u32 = 0x20;
        const WCG_SUPPORTED: u32 = 0x40;
        const WCG_USER_ENABLED: u32 = 0x80;
        let (sdr, wcg, hdr) = (0, 1, 2);
        let hdr_facts = |supported, enabled| AdvancedColorMetadata {
            supported,
            enabled,
            hdr_only: true,
        };
        // Auto color management on a wide-gamut SDR panel is advanced color, active, but not HDR.
        let wide_gamut =
            advanced_color_from_info2(SUPPORTED | ACTIVE | WCG_SUPPORTED | WCG_USER_ENABLED, wcg);
        assert_eq!(wide_gamut, hdr_facts(false, false));
        assert_eq!(
            advanced_color_from_info2(SUPPORTED | HDR_SUPPORTED | WCG_SUPPORTED, sdr),
            hdr_facts(true, false)
        );
        assert_eq!(
            advanced_color_from_info2(SUPPORTED | ACTIVE | HDR_SUPPORTED | HDR_USER_ENABLED, hdr),
            hdr_facts(true, true)
        );
        let dxgi = Some(DxgiColorMetadata {
            hdr_color_space: false,
            peak_nits: Some(400.0),
        });
        assert_eq!(
            combine_monitor_color(Some(wide_gamut), dxgi),
            MonitorColorMetadata {
                hdr_supported: false,
                hdr_on: false,
                peak_nits: Some(400.0)
            }
        );
    }

    #[test]
    fn info2_is_answered_on_windows_11_24h2_and_later() {
        let build: u32 = read_registry(
            "HKLM",
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
            "CurrentBuildNumber",
        )
        .unwrap()
        .parse()
        .unwrap();
        // A wrong struct size would fail every INFO_2 call and silently fall back to the older query.
        for (device, facts) in display_config_facts() {
            let answered = facts.color.is_some_and(|color| color.hdr_only);
            assert!(
                answered || build < 26_100,
                "{device} on build {build}: {:?}",
                facts.color
            );
        }
    }

    #[test]
    fn refresh_rate_prefers_the_exact_rate_and_treats_0_and_1_as_unknown() {
        let rate = |numerator, denominator| {
            Some(DISPLAYCONFIG_RATIONAL {
                Numerator: numerator,
                Denominator: denominator,
            })
        };
        assert_eq!(refresh_rate(rate(119_880, 1_000), Some(119)), 119.88);
        assert_eq!(refresh_rate(rate(60_000, 1_001), Some(59)), 59.94);
        // A timing a hair off a whole rate is the rate Windows names.
        assert_eq!(refresh_rate(rate(1_439_997, 10_000), Some(143)), 144.0);
        // No usable exact rate: DEVMODE's whole number, unless it is a "hardware default" sentinel.
        assert_eq!(refresh_rate(rate(0, 0), Some(144)), 144.0);
        assert_eq!(refresh_rate(rate(1, 1), Some(60)), 60.0);
        assert_eq!(refresh_rate(None, Some(240)), 240.0);
        for sentinel in [0, 1] {
            assert_eq!(refresh_rate(None, Some(sentinel)), 0.0);
            assert_eq!(refresh_rate(rate(0, 1), Some(sentinel)), 0.0);
        }
        assert_eq!(refresh_rate(None, None), 0.0);
    }

    #[test]
    fn heliosphere_is_refused_however_its_host_is_spelt() {
        let url = |text: &str| reqwest::Url::parse(text).unwrap();
        for refused in [
            "https://repo.heliosphere.app/latest.zip",
            "https://heliosphere.app/",
            "https://REPO.Heliosphere.App./latest.zip",
            "https://heliosphere.app.:443/x",
            "http://cdn.heliosphere.app/x",
        ] {
            assert!(is_heliosphere(&url(refused)), "{refused}");
            assert_eq!(
                fetchable_url(refused).unwrap_err().message,
                HELIOSPHERE_REFUSED,
                "{refused}"
            );
        }
        for allowed in [
            "https://notheliosphere.app/x",
            "https://heliosphere.app.example.com/x",
            "https://github.com/heliosphere.app/x",
            "https://example.com/?u=heliosphere.app",
        ] {
            assert!(!is_heliosphere(&url(allowed)), "{allowed}");
            assert!(fetchable_url(allowed).is_ok(), "{allowed}");
        }
        assert_eq!(
            fetchable_url("not a url").unwrap_err().kind,
            ErrorKind::Unknown
        );
    }

    #[test]
    fn redirects_must_stay_on_https_off_heliosphere_and_within_ten_hops() {
        let url = |text: &str| reqwest::Url::parse(text).unwrap();
        // A GitHub release asset redirects once, to its storage host.
        let asset = url("https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sig=x");
        assert_eq!(redirect_refusal(&asset, 1), None);
        assert_eq!(redirect_refusal(&asset, MAX_REDIRECTS), None);
        assert!(redirect_refusal(&asset, MAX_REDIRECTS + 1).is_some());
        assert!(redirect_refusal(&url("http://example.com/plugin.zip"), 1)
            .is_some_and(|why| why.contains("HTTPS")));
        assert_eq!(
            redirect_refusal(&url("https://repo.heliosphere.app./latest.zip"), 1),
            Some(HELIOSPHERE_REFUSED)
        );
    }

    #[test]
    fn gpu_adapters_carry_windows_high_performance_rank() {
        let adapters = gpu_adapters().unwrap();
        // IDXGIFactory6 is there from Windows 10 1803, so every listed adapter is ranked.
        let mut ranks: Vec<u32> = adapters
            .iter()
            .map(|adapter| adapter.high_performance_rank.expect("ranked"))
            .collect();
        ranks.sort_unstable();
        ranks.dedup();
        assert_eq!(ranks.len(), adapters.len(), "{adapters:?}");
    }

    #[test]
    fn monitor_dpi_scope_uses_per_monitor_awareness_and_restores_thread_context() {
        use windows::Win32::UI::HiDpi::{
            AreDpiAwarenessContextsEqual, GetThreadDpiAwarenessContext,
        };

        let original = unsafe { GetThreadDpiAwarenessContext() };
        {
            let _scope = MonitorDpiContext::enter().expect("per-monitor DPI context");
            let active = unsafe { GetThreadDpiAwarenessContext() };
            assert!(unsafe {
                AreDpiAwarenessContextsEqual(active, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
                    .as_bool()
                    || AreDpiAwarenessContextsEqual(active, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE)
                        .as_bool()
            });
        }
        let restored = unsafe { GetThreadDpiAwarenessContext() };
        assert!(unsafe { AreDpiAwarenessContextsEqual(original, restored).as_bool() });
    }

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
        let acl = |args: &[&str]| {
            std::process::Command::new("icacls")
                .arg(&folder)
                .args(args)
                .creation_flags(0x08000000)
                .output()
                .unwrap()
        };
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
        let acl = |args: &[&str]| {
            std::process::Command::new("icacls")
                .arg(&shaders)
                .args(args)
                .creation_flags(0x08000000)
                .output()
                .unwrap()
        };
        assert!(acl(&["/deny", "*S-1-1-0:(WD,AD)"]).status.success());
        let result = game_write_access(dir.path(), &["shaders/New.fx".into()]);
        // An unrelated protected subfolder does not require elevation for a write in the root.
        let unrelated = game_write_access(dir.path(), &["OptiScaler.ini".into()]);
        assert!(acl(&["/remove:d", "*S-1-1-0"]).status.success());
        assert!(!result.unwrap());
        assert!(unrelated.unwrap());
        assert_eq!(
            fs::read_to_string(shaders.join("Existing.fx")).unwrap(),
            "User shader"
        );
        assert_eq!(fs::read_dir(&shaders).unwrap().count(), 1);
    }

    #[test]
    fn game_write_probe_checks_replacement_access_to_existing_files() {
        use std::os::windows::process::CommandExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("OptiScaler.ini");
        fs::write(&file, "Passes = 2").unwrap();
        let acl = |path: &Path, args: &[&str]| {
            std::process::Command::new("icacls")
                .arg(path)
                .args(args)
                .creation_flags(0x08000000)
                .output()
                .unwrap()
        };
        // Replacement can use DELETE on the file or DELETE_CHILD on its parent. Deny both.
        assert!(acl(dir.path(), &["/deny", "*S-1-1-0:(DC)"])
            .status
            .success());
        assert!(acl(&file, &["/deny", "*S-1-1-0:(D)"]).status.success());
        let result = game_write_access(dir.path(), &["OptiScaler.ini".into()]);
        assert!(acl(&file, &["/remove:d", "*S-1-1-0"]).status.success());
        assert!(acl(dir.path(), &["/remove:d", "*S-1-1-0"]).status.success());
        assert!(!result.unwrap());
        assert_eq!(fs::read_to_string(file).unwrap(), "Passes = 2");
    }

    #[test]
    fn parses_headless_flags() {
        let parse = |args: &[&str]| headless_mode_from(args.iter().map(std::ffi::OsString::from));
        assert_eq!(parse(&["--headless-check"]), Some("check"));
        assert_eq!(parse(&["--headless-repair"]), Some("repair"));
        assert_eq!(parse(&[]), None);
        assert_eq!(parse(&["--lucent-resume", r"C:\resume.json"]), None);
        assert_eq!(
            parse(&["--lucent-resume", "x.json", "--headless-repair"]),
            Some("repair")
        );
        assert_eq!(parse(&["--headless-checks", "headless-check"]), None);
        assert_eq!(parse(&["--uninstall"]), Some("uninstall"));
    }

    #[test]
    fn escapes_toast_xml() {
        assert_eq!(
            xml_escape(r#"a & <b> "c" 'd'"#),
            "a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;"
        );
    }

    #[test]
    #[ignore = "shows a real toast"]
    fn shows_a_toast() {
        notify("Lucent test", "Toast smoke test <ok> & fine").unwrap();
    }

    const SYSTEM32: &str = r"C:\Windows\System32";

    #[test]
    fn removal_script_quotes_folders_and_rejects_unsafe_ones() {
        let script = build_removal_script(
            Path::new(SYSTEM32),
            &[PathBuf::from(r"C:\Users\Me\AppData\Local\Lucent")],
            &[],
        )
        .unwrap();
        // ping by its full path: a bare name would let a ping.com in the working folder run instead.
        assert!(
            script.starts_with(
                r#""C:\Windows\System32\ping.exe" -n 3 127.0.0.1 >nul & rmdir /s /q "C:\Users\Me\AppData\Local\Lucent""#
            ),
            "got {script}"
        );
        assert_eq!(script.matches("rmdir").count(), 3);
        assert_eq!(
            script.matches(r#""C:\Windows\System32\ping.exe""#).count(),
            3
        );
        assert!(!script.contains(" ping "), "got {script}");
        for bad in [
            r"Users\Me\Local\Lucent",
            "C:\\Users\\Me\\\"x\\Lucent",
            r"C:\Users\%TEMP%\Lucent",
            r"C:\Users\!TEMP!\Lucent",
            r"C:\Lucent",
            r"C:\Users\Me\Local\Other",
            r"C:\Users\Me\..\Lucent",
            "C:\\Users\\Me\\Local\\Lucent\n",
        ] {
            assert_eq!(
                build_removal_script(Path::new(SYSTEM32), &[PathBuf::from(bad)], &[])
                    .unwrap_err()
                    .kind,
                ErrorKind::Unknown,
                "{bad}"
            );
        }
        assert!(build_removal_script(Path::new(SYSTEM32), &[], &[]).is_err());
        assert!(build_removal_script(
            Path::new(SYSTEM32),
            &[PathBuf::from(r"c:\users\me\appdata\local\lucent")],
            &[]
        )
        .is_ok());
    }

    #[test]
    fn extra_removal_folders_skip_only_the_name_rule() {
        let system32 = Path::new(SYSTEM32);
        let lucent = PathBuf::from(r"C:\Users\Me\AppData\Local\Lucent");
        let webview = PathBuf::from(r"C:\Users\Me\AppData\Local\io.github.lucent");
        assert!(build_removal_script(
            system32,
            std::slice::from_ref(&lucent),
            std::slice::from_ref(&webview)
        )
        .is_ok());
        assert!(build_removal_script(
            system32,
            std::slice::from_ref(&lucent),
            &[PathBuf::from(r"C:\Local")]
        )
        .is_err());
        for bad in [r"C:\Users\Me\%x%", r"C:\Users\Me\x!y!z"] {
            assert!(build_removal_script(
                system32,
                std::slice::from_ref(&lucent),
                &[PathBuf::from(bad)]
            )
            .is_err());
        }
    }

    #[test]
    fn the_removal_script_runs_its_programs_from_system32_and_removes_the_folders() {
        let system32 = system32();
        assert!(
            system32.join("ping.exe").is_file(),
            "{}",
            system32.display()
        );
        let dir = tempfile::tempdir().unwrap();
        let lucent = dir.path().join("data").join("Lucent");
        let webview = dir.path().join("data").join("io.github.lucent");
        for folder in [&lucent, &webview] {
            fs::create_dir_all(folder.join("Backups")).unwrap();
            fs::write(folder.join("Backups").join("winmm.dll"), "MZ").unwrap();
        }
        let script = build_removal_script(
            &system32,
            std::slice::from_ref(&lucent),
            std::slice::from_ref(&webview),
        )
        .unwrap();
        let mut command = removal_command(&system32, &script);
        assert_eq!(
            command.get_current_dir(),
            Some(system32.as_path()),
            "nothing beside the script's programs can stand in for them"
        );
        command.status().unwrap();
        assert!(!lucent.exists() && !webview.exists());
        assert!(dir.path().join("data").is_dir());
    }

    #[test]
    fn removing_the_registration_also_removes_the_toast_registration() {
        let id = format!("LucentTest-{}", std::process::id());
        // A throwaway AppUserModelID: the real one belongs to the maintainer's installed Lucent.
        let aumid = format!("{AUMID}.test-{}", std::process::id());
        let aumid_key = format!(r"{AUMID_KEY}\{aumid}");
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        set_uninstall_entry(
            &id,
            serde_json::json!({ "DisplayName": "Lucent test" })
                .as_object()
                .unwrap(),
        )
        .unwrap();
        hkcu.create_subkey(&aumid_key)
            .unwrap()
            .0
            .set_value("DisplayName", &"Lucent test")
            .unwrap();
        let removed = remove_registration(&id, &aumid);
        let aumid_left = hkcu.open_subkey(&aumid_key).is_ok();
        let _ = delete_user_key(&aumid_key);
        let _ = delete_user_key(&uninstall_key_path(&id).unwrap());
        removed.unwrap();
        assert!(!aumid_left, "the toast registration is left behind");
        // Both already gone is success too.
        remove_registration(&id, &aumid).unwrap();
    }

    #[test]
    fn uninstall_entry_ids_cannot_escape_the_uninstall_key() {
        for bad in [r"..\x", r"a\b", "", "a b", "a/b"] {
            assert_eq!(
                set_uninstall_entry(bad, &serde_json::Map::new())
                    .unwrap_err()
                    .kind,
                ErrorKind::Unknown,
                "{bad:?}"
            );
            assert_eq!(
                remove_uninstall_entry(bad).unwrap_err().kind,
                ErrorKind::Unknown,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn uninstall_entry_round_trips_and_removing_a_missing_one_succeeds() {
        let id = format!("LucentTest-{}", std::process::id());
        let values = serde_json::json!({ "DisplayName": "Lucent test", "NoModify": 1, "EstimatedSize": 4096 });
        set_uninstall_entry(&id, values.as_object().unwrap()).unwrap();
        let result = std::panic::catch_unwind(|| {
            let key = RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey(format!(r"{UNINSTALL_KEY}\{id}"))
                .unwrap();
            assert_eq!(
                key.get_value::<String, _>("DisplayName").unwrap(),
                "Lucent test"
            );
            assert_eq!(key.get_value::<u32, _>("NoModify").unwrap(), 1);
            assert_eq!(key.get_value::<u32, _>("EstimatedSize").unwrap(), 4096);
        });
        let bad = set_uninstall_entry(&id, serde_json::json!({ "Size": -1 }).as_object().unwrap());
        remove_uninstall_entry(&id).unwrap();
        remove_uninstall_entry(&id).unwrap();
        result.unwrap();
        assert_eq!(bad.unwrap_err().kind, ErrorKind::Unknown);
        assert!(RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(format!(r"{UNINSTALL_KEY}\{id}"))
            .is_err());
    }

    #[test]
    fn creates_and_replaces_a_shortcut() {
        let dir = tempfile::tempdir().unwrap();
        let link = dir.path().join("Programs").join("Lucent.lnk");
        create_shortcut(&link, Path::new(r"C:\Windows\System32\notepad.exe")).unwrap();
        assert!(fs::metadata(&link).unwrap().len() > 0);
        create_shortcut(&link, Path::new(r"C:\Windows\System32\calc.exe")).unwrap();
        assert!(fs::metadata(&link).unwrap().len() > 0);
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
    fn reads_utf16_text_by_its_byte_order_mark() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("ReShade.ini");
        let text = "[INPUT]\r\nKeyOverlay=36,0,0,0\r\nPresetPath=.\\Été 🫧.ini\r\n";
        let units = || text.encode_utf16();
        let little: Vec<u8> = [0xff, 0xfe]
            .into_iter()
            .chain(units().flat_map(u16::to_le_bytes))
            .collect();
        let big: Vec<u8> = [0xfe, 0xff]
            .into_iter()
            .chain(units().flat_map(u16::to_be_bytes))
            .collect();
        for bytes in [little, big] {
            fs::write(&file, bytes).unwrap();
            assert_eq!(read_text(&file).unwrap(), text);
        }
        // An odd byte count, a lone surrogate or bytes that are not UTF-8 are not text.
        for bad in [
            &b"\xff\xfeA"[..],
            b"\xff\xfe\x00\xd8",
            b"\xef\xbb\xbfbad \xff",
        ] {
            fs::write(&file, bad).unwrap();
            let error = read_text(&file).unwrap_err();
            assert_eq!(error.kind, ErrorKind::Unknown, "{bad:?}");
            assert_eq!(error.path.as_deref(), Some(file.to_str().unwrap()));
        }
    }

    #[test]
    fn a_full_disk_is_disk_full_even_through_a_temp_files_wrapped_error() {
        for code in [39, 112] {
            let raw = io::Error::from_raw_os_error(code);
            let kind = raw.kind();
            assert_eq!(
                PlatformError::io(raw, None).kind,
                ErrorKind::DiskFull,
                "{code}"
            );
            // NamedTempFile's Write re-wraps an error as io::Error::new(kind, PathError), dropping the raw code.
            let wrapped = io::Error::new(
                kind,
                format!("os error {code} at path \"C:\\Lucent\\.tmp1\""),
            );
            assert_eq!(wrapped.raw_os_error(), None);
            assert_eq!(
                PlatformError::io(wrapped, None).kind,
                ErrorKind::DiskFull,
                "{code}"
            );
        }
    }

    #[test]
    fn stat_reports_the_read_only_attribute() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("dalamudConfig.json");
        fs::write(&file, "{}").unwrap();
        assert!(!stat(&file).unwrap().read_only);
        let mut permissions = fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&file, permissions).unwrap();
        let read_only = stat(&file).unwrap();
        let batched = crate::files::stat_many(std::slice::from_ref(&file)).unwrap();
        // A replacement clears the attribute, which also lets the temporary folder go.
        crate::files::write_text(&file, "{}", None).unwrap();
        assert!(read_only.read_only);
        assert_eq!(serde_json::to_value(&read_only).unwrap()["readOnly"], true);
        assert!(batched[0].as_ref().unwrap().read_only);
        assert!(!stat(&file).unwrap().read_only);
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

        assert_eq!(
            read_text(dir.path()).unwrap_err().kind,
            ErrorKind::AccessDenied
        );
    }

    #[test]
    fn a_file_held_open_by_another_process_is_locked() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("winmm.dll");
        fs::write(&file, "MZ").unwrap();
        // Share mode 0: nobody else may open it, which is how a running game holds its DLLs.
        let _held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&file)
            .unwrap();

        assert_eq!(read_text(&file).unwrap_err().kind, ErrorKind::Locked);
    }

    #[test]
    fn stats_files_and_folders() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("ffxiv_dx11.exe");
        fs::write(&file, "MZ12").unwrap();

        let f = stat(&file).unwrap();
        assert_eq!((f.kind, f.size), ("file", 4));
        assert!(
            f.modified_ms > 1_600_000_000_000,
            "modified time is in ms since the epoch"
        );
        assert_eq!(stat(dir.path()).unwrap().kind, "dir");
    }

    #[test]
    fn reads_a_registry_value() {
        let name = read_registry(
            "HKLM",
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
            "ProductName",
        )
        .unwrap();

        assert!(name.starts_with("Windows"), "got {name}");
    }

    #[test]
    fn resolves_current_user_sid_and_round_trips_only_an_isolated_gpu_preference_value() {
        let sid = current_user_sid().unwrap();
        assert!(user_gpu_preferences_subkey(&sid).is_ok(), "SID was {sid}");
        let executable = format!(r"C:\Lucent-Test-{}\ffxiv_dx11.exe", std::process::id());
        let before = read_user_gpu_preferences(&sid, &executable).unwrap();
        let test_value = "GpuPreference=2;AutoHDREnable=2096;";
        let result = (|| {
            write_user_gpu_preferences(&sid, &executable, Some(test_value))?;
            assert_eq!(
                read_user_gpu_preferences(&sid, &executable)?,
                Some(test_value.to_owned())
            );
            write_user_gpu_preferences(&sid, &executable, None)?;
            assert_eq!(read_user_gpu_preferences(&sid, &executable)?, None);
            Ok::<(), PlatformError>(())
        })();
        write_user_gpu_preferences(&sid, &executable, before.as_deref()).unwrap();
        result.unwrap();
    }

    #[test]
    fn rejects_a_registry_sid_that_could_escape_the_player_hive() {
        assert!(user_gpu_preferences_subkey(r"S-1-5-21-1\Software").is_err());
        assert!(user_gpu_preferences_subkey("S-1-5").is_err());
    }

    #[test]
    fn a_missing_registry_key_or_value_is_not_found() {
        let missing_key =
            read_registry("HKCU", r"Software\Lucent\DoesNotExist", "Value").unwrap_err();
        let missing_value = read_registry(
            "HKLM",
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
            "NoSuchValue",
        )
        .unwrap_err();

        assert_eq!(missing_key.kind, ErrorKind::NotFound);
        assert_eq!(missing_value.kind, ErrorKind::NotFound);
    }

    #[test]
    fn resolves_well_known_folders() {
        for folder in ["AppData", "LocalAppData", "ProgramFiles", "ProgramFilesX86"] {
            let path = env_folder(folder).unwrap();
            assert!(Path::new(&path).is_dir(), "{folder} → {path}");
        }
        for folder in ["Documents", "Pictures"] {
            assert!(
                Path::new(&env_folder(folder).unwrap()).is_absolute(),
                "{folder}"
            );
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
            assert_eq!(
                read_text_tail(&path, max_lines).unwrap(),
                expected,
                "source {source:?}"
            );
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
    fn tail_reads_no_more_than_its_byte_window_and_starts_on_a_whole_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("OptiScaler.log");
        fs::write(&path, "aaaa\nbbbb\ncccc\n").unwrap();
        // The window reaches back into "bbbb": that partial line is left out.
        assert_eq!(read_text_tail_limited(&path, 300, 7).unwrap(), "cccc");
        // A window holding the whole file, or the wanted lines, changes nothing.
        assert_eq!(
            read_text_tail_limited(&path, 300, 14).unwrap(),
            "aaaa\nbbbb\ncccc"
        );
        assert_eq!(read_text_tail_limited(&path, 2, 10).unwrap(), "bbbb\ncccc");
        // With no line break in reach, the window's own bytes come back, from a whole character.
        fs::write(&path, format!("{}\n", "é".repeat(20))).unwrap();
        assert_eq!(read_text_tail_limited(&path, 300, 9).unwrap(), "éééé");
        // Across scan chunks: one 20 KiB line, then two short ones.
        fs::write(&path, format!("{}\nend 1\nend 2", "x".repeat(20 * 1024))).unwrap();
        assert_eq!(
            read_text_tail_limited(&path, 300, 10 * 1024).unwrap(),
            "end 1\nend 2"
        );
    }

    #[test]
    fn tail_of_a_huge_log_without_line_breaks_stays_within_the_byte_window() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ReShade.log");
        let file = fs::File::create(&path).unwrap();
        file.set_len(3 * MAX_TAIL_BYTES).unwrap();
        drop(file);
        let tail = read_text_tail(&path, 500).unwrap();
        assert_eq!(tail.len() as u64, MAX_TAIL_BYTES);
        // Two thousand activity-log lines of 512 bytes fit: log.ts keeps 2,000 when it trims lucent.log.
        const { assert!(MAX_TAIL_BYTES >= 2_000 * 512) };
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

        assert_eq!(
            read_text_tail(&path, 300).unwrap(),
            final_lines[5..].join("\n")
        );
    }
}
