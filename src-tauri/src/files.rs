//! File primitives for deployment; recipe and journal decisions stay in the TypeScript core.
use crate::platform::{ErrorKind, PlatformError, Result};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};

fn temp_file(path: &Path, staging_directory: Option<&Path>) -> Result<tempfile::NamedTempFile> {
    let parent = path.parent().ok_or_else(|| PlatformError::new(ErrorKind::Unknown, "File needs a parent folder", Some(path)))?;
    fs::create_dir_all(parent).map_err(|e| PlatformError::io(e, Some(parent)))?;
    // The core supplies a sibling outside the game folder for game writes. Atomic persist
    // still requires the same volume, but an abruptly killed process leaves no game file.
    // A staging folder Windows won't let us write to (such as a drive root) falls back to the destination's.
    if let Some(Ok(file)) = staging_directory.map(tempfile::NamedTempFile::new_in) { return Ok(file); }
    tempfile::NamedTempFile::new_in(parent).map_err(|e| PlatformError::io(e, Some(path)))
}

fn commit(file: tempfile::NamedTempFile, path: &Path, replace: bool) -> Result<()> {
    file.as_file().sync_all().map_err(|e| PlatformError::io(e, Some(path)))?;
    if replace { file.persist(path).map_err(|e| mutation_error(e.error, path))?; }
    else { file.persist_noclobber(path).map_err(|e| mutation_error(e.error, path))?; }
    Ok(())
}

fn mutation_error(error: std::io::Error, path: &Path) -> PlatformError {
    let classified = PlatformError::io(error, Some(path));
    // Windows replacement may report AccessDenied for an exclusively open destination.
    if classified.kind == ErrorKind::AccessDenied {
        if let Err(error) = File::open(path) {
            let probe = PlatformError::io(error, Some(path));
            if probe.kind == ErrorKind::Locked { return probe; }
        }
    }
    classified
}

pub fn write_text(path: &Path, text: &str, staging_directory: Option<&Path>) -> Result<()> {
    let mut file = temp_file(path, staging_directory)?;
    file.write_all(text.as_bytes()).map_err(|e| PlatformError::io(e, Some(path)))?;
    commit(file, path, true)
}

pub fn write_file_byte(path: &Path, offset: u64, value: u8) -> Result<()> {
    let mut file = fs::OpenOptions::new().write(true).open(path).map_err(|e| PlatformError::io(e, Some(path)))?;
    if offset >= file.metadata().map_err(|e| PlatformError::io(e, Some(path)))?.len() {
        return Err(PlatformError::new(ErrorKind::Unknown, "Byte write would extend the file", Some(path)));
    }
    file.seek(SeekFrom::Start(offset)).map_err(|e| PlatformError::io(e, Some(path)))?;
    file.write_all(&[value]).map_err(|e| PlatformError::io(e, Some(path)))?;
    file.sync_all().map_err(|e| PlatformError::io(e, Some(path)))
}

pub fn copy_file(from: &Path, to: &Path, replace: bool, staging_directory: Option<&Path>) -> Result<()> {
    let mut source = File::open(from).map_err(|e| PlatformError::io(e, Some(from)))?;
    let mut file = temp_file(to, staging_directory)?;
    std::io::copy(&mut source, &mut file).map_err(|e| PlatformError::io(e, Some(to)))?;
    commit(file, to, replace)
}

pub fn rename_file(from: &Path, to: &Path, replace: bool) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
    if let Some(parent) = to.parent() { fs::create_dir_all(parent).map_err(|e| PlatformError::io(e, Some(parent)))?; }
    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    let flags = MOVEFILE_WRITE_THROUGH | if replace { MOVEFILE_REPLACE_EXISTING } else { MOVE_FILE_FLAGS(0) };
    // SAFETY: the two NUL-terminated buffers live through the call. No pointers escape.
    unsafe { MoveFileExW(PCWSTR(from_wide.as_ptr()), PCWSTR(to_wide.as_ptr()), flags) }
        .map_err(|_| mutation_error(std::io::Error::last_os_error(), to))
}

pub fn remove_file(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(mutation_error(e, path)),
    }
}

pub fn remove_directory_if_empty(path: &Path) -> Result<()> {
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        // A folder that gained someone else's file stays, along with that file.
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty) => Ok(()),
        Err(e) => Err(PlatformError::io(e, Some(path))),
    }
}

pub fn hash_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(|e| PlatformError::io(e, Some(path)))?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buffer).map_err(|e| PlatformError::io(e, Some(path)))?;
        if n == 0 { break; }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn reject_reparse(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_attributes() & 0x400 != 0 => Err(PlatformError::new(ErrorKind::AccessDenied, "A game-folder path contains a junction or symbolic link", Some(path))),
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(PlatformError::io(e, Some(path))),
    }
}

pub fn resolve_game_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let mut target = root.to_path_buf();
    for ancestor in root.ancestors() { reject_reparse(ancestor)?; }
    if !root.is_dir() { return Err(PlatformError::new(ErrorKind::NotFound, "Game folder is missing", Some(root))); }
    for part in relative.split(['/', '\\']) {
        let stem = part.split('.').next().unwrap_or("").to_ascii_lowercase();
        let device = ["con", "prn", "aux", "nul"].contains(&stem.as_str())
            || (stem.chars().count() == 4 && (stem.starts_with("com") || stem.starts_with("lpt"))
                && matches!(stem.chars().nth(3), Some('1'..='9' | '¹' | '²' | '³')));
        if part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' ']) || device
            || part.chars().any(|c| c.is_control() || "<>:\"|?*".contains(c)) {
            return Err(PlatformError::new(ErrorKind::AccessDenied, "Unsafe game-folder path", Some(Path::new(relative))));
        }
        target.push(part);
        reject_reparse(&target)?;
    }
    Ok(target)
}

pub fn list_files(root: &Path) -> Result<Vec<String>> {
    fn visit(root: &Path, dir: &Path, files: &mut Vec<String>) -> Result<()> {
        reject_reparse(dir)?;
        for entry in fs::read_dir(dir).map_err(|e| PlatformError::io(e, Some(dir)))? {
            let path = entry.map_err(|e| PlatformError::io(e, Some(dir)))?.path();
            reject_reparse(&path)?;
            if path.is_dir() { visit(root, &path, files)?; }
            else { files.push(path.strip_prefix(root).unwrap().to_string_lossy().into_owned()); }
        }
        Ok(())
    }
    let mut files = Vec::new();
    visit(root, root, &mut files)?;
    Ok(files)
}

pub async fn download_file(url: &str, to: &Path, progress: tauri::ipc::Channel<u64>) -> Result<()> {
    let error = |e: reqwest::Error| PlatformError::new(
        if e.status() == Some(reqwest::StatusCode::NOT_FOUND) { ErrorKind::NotFound } else { ErrorKind::Network }, e.to_string(), None);
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(600))
        .user_agent(concat!("Lucent/", env!("CARGO_PKG_VERSION"))).build().map_err(error)?;
    let mut response = client.get(url).send().await.map_err(error)?.error_for_status().map_err(error)?;
    let mut file = temp_file(to, None)?;
    let mut received = 0;
    while let Some(chunk) = response.chunk().await.map_err(error)? {
        file.write_all(&chunk).map_err(|e| PlatformError::io(e, Some(to)))?;
        received += chunk.len() as u64;
        let _ = progress.send(received);
    }
    commit(file, to, true)
}

pub fn is_game_running() -> Result<bool> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let error = |e: windows::core::Error| PlatformError::new(ErrorKind::Unknown, e.to_string(), None);
    // SAFETY: the snapshot owns the enumeration; CloseHandle runs on every exit. The entry is owned.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).map_err(error)?;
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut next = Process32FirstW(snapshot, &mut entry);
        let mut running = false;
        while next.is_ok() {
            let len = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..len]).eq_ignore_ascii_case("ffxiv_dx11.exe") { running = true; break; }
            next = Process32NextW(snapshot, &mut entry);
        }
        let _ = CloseHandle(snapshot);
        if !running {
            if let Err(e) = next { if e.code().0 as u32 != 0x80070012 { return Err(error(e)); } }
        }
        Ok(running)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn copies_binary_files_atomically_and_hashes_their_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.dll");
        let target = dir.path().join("cache").join("file");
        fs::write(&source, b"\x00\xff\x01").unwrap();
        copy_file(&source, &target, true, None).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"\x00\xff\x01");
        fs::write(&source, b"OptiScaler").unwrap();
        assert_eq!(hash_file(&source).unwrap(), "f1a59411e0090ae0608b2e78d73533a7f6ba41442589345f46631822f2dbae02");
        write_text(&target, "complete replacement", None).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "complete replacement");
    }

    #[test]
    fn stages_game_writes_outside_the_destination_and_falls_back_when_staging_is_unusable() {
        let dir = tempfile::tempdir().unwrap();
        let staging = dir.path().join("staging");
        let target = dir.path().join("game").join("ReShade.ini");
        fs::create_dir(&staging).unwrap();
        write_text(&target, "staged", Some(&staging)).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "staged");
        assert_eq!(fs::read_dir(&staging).unwrap().count(), 0);
        write_text(&target, "fallback", Some(&dir.path().join("missing"))).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "fallback");
        assert_eq!(fs::read_dir(target.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn writes_one_preallocated_byte_and_refuses_to_extend_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("rollback.txt");
        fs::write(&file, "000").unwrap();
        write_file_byte(&file, 1, b'1').unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "010");
        assert!(write_file_byte(&file, 3, b'1').is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "010");
    }

    #[test]
    fn removes_a_directory_only_while_it_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let full = dir.path().join("reshade-presets");
        fs::create_dir(&full).unwrap();
        fs::write(full.join("My preset.ini"), "user").unwrap();
        remove_directory_if_empty(&full).unwrap();
        assert_eq!(fs::read_to_string(full.join("My preset.ini")).unwrap(), "user");
        let empty = dir.path().join("reshade-shaders");
        fs::create_dir(&empty).unwrap();
        remove_directory_if_empty(&empty).unwrap();
        assert!(!empty.exists());
        remove_directory_if_empty(&empty).unwrap();
    }

    #[test]
    fn rejects_windows_path_escapes_and_aliases() {
        let dir = tempfile::tempdir().unwrap();
        for path in ["../outside", "..\\outside", "C:\\outside", "\\outside", "folder/../outside", "file:stream", "nul.ini", "COM¹.dll", "LPT².ini", "folder./file", "file "] {
            assert!(resolve_game_path(dir.path(), path).is_err(), "accepted {path}");
        }
        assert_eq!(resolve_game_path(dir.path(), "shaders/Example.fx").unwrap(), dir.path().join("shaders").join("Example.fx"));
    }

    #[test]
    fn rejects_a_junction_leading_outside_the_game_folder() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let link = dir.path().join("shaders");
        // Directory junctions need no developer mode or administrator privileges.
        let result = std::process::Command::new("cmd").args(["/c", "mklink", "/J"])
            .arg(&link).arg(outside.path()).output().unwrap();
        assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        assert!(resolve_game_path(dir.path(), "shaders/Example.fx").is_err());
        fs::remove_dir(link).unwrap();
    }

    #[test]
    fn rejects_a_game_root_beneath_a_junction() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir_all(outside.path().join("XIV").join("game")).unwrap();
        let link = dir.path().join("library");
        let result = std::process::Command::new("cmd").args(["/c", "mklink", "/J"])
            .arg(&link).arg(outside.path()).output().unwrap();
        assert!(result.status.success());
        let rejected = resolve_game_path(&link.join("XIV").join("game"), "winmm.dll").is_err();
        fs::remove_dir(link).unwrap();
        assert!(rejected, "ancestor junction must be rejected");
    }

    #[test]
    fn failed_atomic_replacement_leaves_the_original_bytes_intact() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        let target = dir.path().join("target");
        fs::write(&source, "new bytes").unwrap();
        fs::write(&target, "original bytes").unwrap();
        let held = fs::OpenOptions::new().read(true).share_mode(0).open(&target).unwrap();
        assert_eq!(copy_file(&source, &target, true, None).unwrap_err().kind, ErrorKind::Locked);
        drop(held);
        assert_eq!(fs::read_to_string(&target).unwrap(), "original bytes");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2, "temporary files are removed on failure");
        rename_file(&source, &target, true).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "new bytes");
        assert!(!source.exists());
    }

    #[test]
    fn atomic_copy_and_rename_refuse_an_unexpected_destination() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        let target = dir.path().join("target");
        fs::write(&source, "Lucent bytes").unwrap();
        fs::write(&target, "User bytes").unwrap();
        assert!(copy_file(&source, &target, false, None).is_err());
        assert!(rename_file(&source, &target, false).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "User bytes");
        assert_eq!(fs::read_to_string(&source).unwrap(), "Lucent bytes");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
