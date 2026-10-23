//! File primitives for deployment; recipe and journal decisions stay in the TypeScript core.
use crate::platform::{ErrorKind, PlatformError, Result};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};

fn temp_file(path: &Path, staging_directory: Option<&Path>) -> Result<tempfile::NamedTempFile> {
    let parent = path.parent().ok_or_else(|| {
        PlatformError::new(ErrorKind::Unknown, "File needs a parent folder", Some(path))
    })?;
    fs::create_dir_all(parent).map_err(|e| PlatformError::io(e, Some(parent)))?;
    // The core supplies a sibling outside the game folder for game writes. Atomic persist
    // still requires the same volume, but an abruptly killed process leaves no game file.
    // A staging folder Windows won't let us write to (such as a drive root) falls back to the destination's.
    if let Some(Ok(file)) = staging_directory.map(tempfile::NamedTempFile::new_in) {
        return Ok(file);
    }
    tempfile::NamedTempFile::new_in(parent).map_err(|e| PlatformError::io(e, Some(path)))
}

/// A read-only destination (the common "protect ReShade.ini" tip) must not fail every install:
/// the journal already holds a backup, so clear the flag and let the replacement proceed.
fn clear_readonly(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        if meta.permissions().readonly() {
            let mut permissions = meta.permissions();
            permissions.set_readonly(false);
            let _ = fs::set_permissions(path, permissions);
        }
    }
}

fn commit(file: tempfile::NamedTempFile, path: &Path, replace: bool) -> Result<()> {
    file.as_file()
        .sync_all()
        .map_err(|e| PlatformError::io(e, Some(path)))?;
    if replace {
        clear_readonly(path);
        file.persist(path)
            .map_err(|e| mutation_error(e.error, path))?;
    } else {
        file.persist_noclobber(path)
            .map_err(|e| mutation_error(e.error, path))?;
    }
    Ok(())
}

fn mutation_error(error: std::io::Error, path: &Path) -> PlatformError {
    let classified = PlatformError::io(error, Some(path));
    // Windows replacement may report AccessDenied for an exclusively open destination.
    if classified.kind == ErrorKind::AccessDenied {
        if let Err(error) = File::open(path) {
            let probe = PlatformError::io(error, Some(path));
            if probe.kind == ErrorKind::Locked {
                return probe;
            }
        }
    }
    classified
}

pub fn write_text(path: &Path, text: &str, staging_directory: Option<&Path>) -> Result<()> {
    let mut file = temp_file(path, staging_directory)?;
    file.write_all(text.as_bytes())
        .map_err(|e| PlatformError::io(e, Some(path)))?;
    commit(file, path, true)
}

/// Appends to a text file, creating it and its folder when missing. Each call is a single write,
/// so the lines of two Lucent processes never interleave. Not flushed to disk: this is for logs.
pub fn append_text(path: &Path, text: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| PlatformError::io(e, Some(parent)))?;
    }
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| file.write_all(text.as_bytes()))
        .map_err(|e| PlatformError::io(e, Some(path)))
}

pub fn write_file_byte(path: &Path, offset: u64, value: u8) -> Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|e| PlatformError::io(e, Some(path)))?;
    if offset
        >= file
            .metadata()
            .map_err(|e| PlatformError::io(e, Some(path)))?
            .len()
    {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            "Byte write would extend the file",
            Some(path),
        ));
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| PlatformError::io(e, Some(path)))?;
    file.write_all(&[value])
        .map_err(|e| PlatformError::io(e, Some(path)))?;
    file.sync_all()
        .map_err(|e| PlatformError::io(e, Some(path)))
}

pub fn copy_file(
    from: &Path,
    to: &Path,
    replace: bool,
    staging_directory: Option<&Path>,
) -> Result<()> {
    let mut source = File::open(from).map_err(|e| PlatformError::io(e, Some(from)))?;
    let mut file = temp_file(to, staging_directory)?;
    std::io::copy(&mut source, &mut file).map_err(|e| PlatformError::io(e, Some(to)))?;
    commit(file, to, replace)
}

pub fn rename_file(from: &Path, to: &Path, replace: bool) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MOVE_FILE_FLAGS,
    };
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| PlatformError::io(e, Some(parent)))?;
    }
    if replace {
        clear_readonly(to);
    }
    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    let flags = MOVEFILE_WRITE_THROUGH
        | if replace {
            MOVEFILE_REPLACE_EXISTING
        } else {
            MOVE_FILE_FLAGS(0)
        };
    // SAFETY: the two NUL-terminated buffers live through the call. No pointers escape.
    unsafe { MoveFileExW(PCWSTR(from_wide.as_ptr()), PCWSTR(to_wide.as_ptr()), flags) }
        .map_err(|_| mutation_error(std::io::Error::last_os_error(), to))
}

pub fn remove_file(path: &Path) -> Result<()> {
    clear_readonly(path);
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
        Err(e)
            if matches!(
                e.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(())
        }
        Err(e) => Err(PlatformError::io(e, Some(path))),
    }
}

pub fn hash_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(|e| PlatformError::io(e, Some(path)))?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|e| PlatformError::io(e, Some(path)))?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn reject_reparse(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_attributes() & 0x400 != 0 => Err(PlatformError::new(
            ErrorKind::AccessDenied,
            "A game-folder path contains a junction or symbolic link",
            Some(path),
        )),
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(PlatformError::io(e, Some(path))),
    }
}

/// Why a single path part cannot be created as written on Windows, if it cannot: an empty or relative part, a
/// trailing dot or space, a legacy device name (`CON`, `COM1`, `LPT¹`, with or without an extension), or a
/// character Windows reserves (`:` also names NTFS alternate streams and drive letters).
fn unsafe_path_part(part: &str) -> Option<&'static str> {
    // Windows ignores spaces between a device name and its extension, so `con .txt` is the console too.
    let stem = part
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_ascii_lowercase();
    let device = ["con", "prn", "aux", "nul"].contains(&stem.as_str())
        || (stem.chars().count() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.chars().nth(3), Some('1'..='9' | '¹' | '²' | '³')));
    if part.is_empty() {
        Some("empty path part")
    } else if part == "." || part == ".." {
        Some("relative path part")
    } else if part.contains(':') {
        Some("':' (drive letter or alternate data stream)")
    } else if part.ends_with(['.', ' ']) {
        Some("name ends with a dot or space")
    } else if device {
        Some("reserved device name")
    } else if part
        .chars()
        .any(|c| c.is_control() || "<>\"|?*".contains(c))
    {
        Some("character Windows does not allow in names")
    } else {
        None
    }
}

pub fn resolve_game_path(root: &Path, relative: &str) -> Result<PathBuf> {
    Ok(resolve_game_paths(root, &[relative.to_owned()])?.remove(0))
}

/// Resolves many relative paths with `resolve_game_path`'s checks, checking each directory for a reparse point once.
pub fn resolve_game_paths(root: &Path, relatives: &[String]) -> Result<Vec<PathBuf>> {
    for ancestor in root.ancestors() {
        reject_reparse(ancestor)?;
    }
    if !root.is_dir() {
        return Err(PlatformError::new(
            ErrorKind::NotFound,
            "Game folder is missing",
            Some(root),
        ));
    }
    let mut checked = std::collections::HashSet::new();
    relatives
        .iter()
        .map(|relative| {
            let mut target = root.to_path_buf();
            for part in relative.split(['/', '\\']) {
                if unsafe_path_part(part).is_some() {
                    return Err(PlatformError::new(
                        ErrorKind::AccessDenied,
                        "Unsafe game-folder path",
                        Some(Path::new(relative)),
                    ));
                }
                target.push(part);
                if checked.insert(target.clone()) {
                    reject_reparse(&target)?;
                }
            }
            Ok(target)
        })
        .collect()
}

/// The folder an Open folder button may show, checked before Windows is asked to open it. The webview names the path,
/// so this is the boundary, not the TypeScript check before it: only `X:\` on this PC, every name a plain one (no `.`
/// or `..`, stream, wildcard or device), and a folder that exists and is not itself a junction or symbolic link.
pub fn validate_open_folder(path: &str) -> Result<PathBuf> {
    let refuse = |why: &str| {
        PlatformError::new(
            ErrorKind::AccessDenied,
            format!("Lucent opens only a folder on this PC: {why}."),
            Some(Path::new(path)),
        )
    };
    // Two leading separators are a network share (`\\server`), a device (`\\.\`) or a verbatim path (`\\?\`).
    let names = match path.as_bytes() {
        [drive, b':', b'\\', ..] if drive.is_ascii_alphabetic() => &path[3..],
        _ => return Err(refuse("the path doesn’t start with a drive letter")),
    };
    if let Some(why) = names.split(['\\', '/']).find_map(unsafe_path_part) {
        return Err(refuse(why));
    }
    let folder = Path::new(path);
    let meta = fs::symlink_metadata(folder).map_err(|e| PlatformError::io(e, Some(folder)))?;
    // A junction counts too: std reports every name-surrogate reparse point as a link.
    if meta.file_type().is_symlink() {
        return Err(refuse("it is a junction or symbolic link"));
    }
    if !meta.is_dir() {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            "This is a file, not a folder.",
            Some(folder),
        ));
    }
    Ok(folder.to_path_buf())
}

/// The bytes the current user can still write on the drive that holds `path`, after any disk quota
/// (`GetDiskFreeSpaceExW`'s space available to the caller). The folders a deployment writes may not exist yet, so the
/// nearest folder above `path` that does is asked. Only a path on a local drive (`X:\…`) is read.
pub fn free_space(path: &Path) -> Result<u64> {
    use std::path::{Component, Prefix};
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let mut components = path.components();
    let local = matches!(components.next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_)))
        && components.next() == Some(Component::RootDir);
    if !local {
        return Err(PlatformError::new(
            ErrorKind::Unknown,
            "Free space is read only for a folder on a local drive.",
            Some(path),
        ));
    }
    let folder = path
        .ancestors()
        .find(|ancestor| fs::metadata(ancestor).is_ok_and(|meta| meta.is_dir()))
        .ok_or_else(|| {
            PlatformError::new(
                ErrorKind::NotFound,
                "No folder on this path exists.",
                Some(path),
            )
        })?;
    let mut available = 0u64;
    // SAFETY: the HSTRING outlives the call, which writes only the one u64 it is given.
    unsafe {
        GetDiskFreeSpaceExW(
            &windows::core::HSTRING::from(folder.as_os_str()),
            Some(&mut available),
            None,
            None,
        )
    }
    .map_err(|e| PlatformError::new(ErrorKind::Unknown, e.to_string(), Some(folder)))?;
    Ok(available)
}

/// Runs `work` over the items on up to eight threads and returns the results in item order. After a failure no new
/// item starts; the first failure in item order is returned once the running items finish.
fn in_parallel<T: Sync, R: Send>(
    items: &[T],
    work: impl Fn(&T) -> Result<R> + Sync,
) -> Result<Vec<R>> {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    let threads = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .clamp(1, 8)
        .min(items.len().max(1));
    let next = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);
    let slots: std::sync::Mutex<Vec<Option<Result<R>>>> =
        std::sync::Mutex::new((0..items.len()).map(|_| None).collect());
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                while !failed.load(Ordering::Relaxed) {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    if index >= items.len() {
                        break;
                    }
                    let result = work(&items[index]);
                    if result.is_err() {
                        failed.store(true, Ordering::Relaxed);
                    }
                    slots.lock().unwrap_or_else(|e| e.into_inner())[index] = Some(result);
                }
            });
        }
    });
    let mut results = Vec::with_capacity(items.len());
    for slot in slots
        .into_inner()
        .unwrap_or_else(|e| e.into_inner())
        .into_iter()
        .flatten()
    {
        results.push(slot?);
    }
    Ok(results)
}

/// `stat` for many paths at once; `None` where nothing exists.
pub fn stat_many(paths: &[PathBuf]) -> Result<Vec<Option<crate::platform::FileStat>>> {
    in_parallel(paths, |path| match crate::platform::stat(path) {
        Ok(stat) => Ok(Some(stat)),
        Err(e) if e.kind == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    })
}

pub fn hash_many(paths: &[PathBuf]) -> Result<Vec<String>> {
    in_parallel(paths, |path| hash_file(path))
}

#[derive(serde::Deserialize)]
pub struct CopyItem {
    pub from: PathBuf,
    pub to: PathBuf,
    pub replace: bool,
}

/// Many `copy_file`s at once, each still atomic and durable; their fsyncs overlap instead of queueing.
pub fn copy_many(items: &[CopyItem], staging_directory: Option<&Path>) -> Result<()> {
    in_parallel(items, |item| {
        copy_file(&item.from, &item.to, item.replace, staging_directory)
    })
    .map(|_| ())
}

pub fn remove_many(paths: &[PathBuf]) -> Result<()> {
    in_parallel(paths, |path| remove_file(path)).map(|_| ())
}

/// Durably changes several already allocated bytes with one flush; refuses to extend the file.
pub fn write_file_bytes(path: &Path, offsets: &[u64], value: u8) -> Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|e| PlatformError::io(e, Some(path)))?;
    let length = file
        .metadata()
        .map_err(|e| PlatformError::io(e, Some(path)))?
        .len();
    for &offset in offsets {
        if offset >= length {
            return Err(PlatformError::new(
                ErrorKind::Unknown,
                "Byte write would extend the file",
                Some(path),
            ));
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| PlatformError::io(e, Some(path)))?;
        file.write_all(&[value])
            .map_err(|e| PlatformError::io(e, Some(path)))?;
    }
    file.sync_all()
        .map_err(|e| PlatformError::io(e, Some(path)))
}

/// `remove_directory_if_empty` for each path, in the given order (deepest first removes a whole empty tree).
pub fn remove_directories_if_empty(paths: &[PathBuf]) -> Result<()> {
    for path in paths {
        remove_directory_if_empty(path)?;
    }
    Ok(())
}

pub fn list_files(root: &Path) -> Result<Vec<String>> {
    fn visit(root: &Path, dir: &Path, files: &mut Vec<String>) -> Result<()> {
        reject_reparse(dir)?;
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            // A subfolder deleted since its parent was listed holds nothing any more; a missing root is still an error.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && dir != root => return Ok(()),
            Err(e) => return Err(PlatformError::io(e, Some(dir))),
        };
        for entry in entries {
            let path = entry.map_err(|e| PlatformError::io(e, Some(dir)))?.path();
            let meta = match fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                // Deleted since read_dir listed it, such as a log a running tool rotated mid-Scan.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(PlatformError::io(e, Some(&path))),
            };
            // A junction or symlink inside the game folder is the player's own arrangement:
            // skip what it points at instead of failing the whole Scan. Write targets still
            // reject reparse points in resolve_game_paths.
            if meta.file_attributes() & 0x400 != 0 {
                continue;
            }
            if meta.is_dir() {
                visit(root, &path, files)?;
            } else {
                files.push(
                    path.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    visit(root, root, &mut files)?;
    Ok(files)
}

/// Names of the immediate subfolders of `root`, sorted ignoring case. Unlike `list_files` this follows junctions
/// and symlinks: it only reads names, and a linked folder is still one of the player's folders. A link whose
/// target is gone is not a folder, so it is left out.
pub fn list_folders(root: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| PlatformError::io(e, Some(root)))? {
        let entry = entry.map_err(|e| PlatformError::io(e, Some(root)))?;
        if entry.path().is_dir() {
            names.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    names.sort_by_cached_key(|name| (name.to_lowercase(), name.clone()));
    Ok(names)
}

/// What `extract_zip` accepts. Counted while unpacking, never read from the archive's own headers.
#[derive(Clone, Copy)]
struct ZipLimits {
    entries: usize,
    total_bytes: u64,
    entry_bytes: u64,
}

const ZIP_LIMITS: ZipLimits = ZipLimits {
    entries: 4_000,
    total_bytes: 256 * 1024 * 1024,
    entry_bytes: 128 * 1024 * 1024,
};

fn zip_failure(zip: &Path, message: impl Into<String>) -> PlatformError {
    PlatformError::new(ErrorKind::Unknown, message, Some(zip))
}

fn rejected_entry(zip: &Path, name: &str, why: impl std::fmt::Display) -> PlatformError {
    zip_failure(zip, format!("Zip entry '{name}' rejected: {why}"))
}

/// A bad archive or entry is `Unknown`; a real I/O failure underneath keeps its kind (locked, disk full...).
fn zip_error(error: zip::result::ZipError, zip: &Path, entry: Option<&str>) -> PlatformError {
    let mut error = match error {
        zip::result::ZipError::Io(e) => PlatformError::io(e, Some(zip)),
        other => zip_failure(zip, format!("Invalid zip archive: {other}")),
    };
    if let Some(name) = entry {
        error.message = format!("Zip entry '{name}' could not be read: {}", error.message);
    }
    error
}

struct ZipEntryPlan {
    index: usize,
    name: String,
    parts: Vec<String>,
    is_dir: bool,
}

/// Vets every entry from the central directory before anything is written, so a hostile archive fails with
/// nothing on disk. Both separators split a name: backslashes are separators on Windows.
fn plan_zip_entries<R: Read + Seek>(
    archive: &zip::ZipArchive<R>,
    zip: &Path,
    limits: ZipLimits,
) -> Result<Vec<ZipEntryPlan>> {
    if archive.len() > limits.entries {
        return Err(zip_failure(
            zip,
            format!(
                "Zip archive has {} entries; at most {} are allowed",
                archive.len(),
                limits.entries
            ),
        ));
    }
    (0..archive.len())
        .map(|index| {
            let entry = archive
                .by_index_data(index)
                .map_err(|e| zip_error(e, zip, None))?;
            let name = entry
                .name()
                .map_err(|e| zip_error(e, zip, None))?
                .into_owned();
            if entry.encrypted() {
                return Err(rejected_entry(
                    zip,
                    &name,
                    "encrypted entries are not supported",
                ));
            }
            if entry.is_symlink()
                || entry
                    .unix_mode()
                    .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err(rejected_entry(zip, &name, "symbolic links are not allowed"));
            }
            let is_dir = entry.is_dir() || name.ends_with(['/', '\\']);
            let path = name.strip_suffix(['/', '\\']).unwrap_or(&name);
            if path.starts_with(['/', '\\']) {
                return Err(rejected_entry(zip, &name, "absolute path"));
            }
            let parts: Vec<String> = path.split(['/', '\\']).map(str::to_owned).collect();
            if let Some((part, why)) = parts
                .iter()
                .find_map(|part| unsafe_path_part(part).map(|why| (part, why)))
            {
                return Err(rejected_entry(zip, &name, format!("'{part}' is {why}")));
            }
            // The library's own check, as a backstop to the rules above.
            if entry.enclosed_name().is_none() {
                return Err(rejected_entry(
                    zip,
                    &name,
                    "path is not enclosed by the destination",
                ));
            }
            Ok(ZipEntryPlan {
                index,
                name,
                parts,
                is_dir,
            })
        })
        .collect()
}

/// Everything one extraction created, so that a failure takes all of it away again and nothing else:
/// a destination folder that was already there (empty) stays.
struct Extracted {
    root: PathBuf,
    files: Vec<PathBuf>,
    dirs: Vec<PathBuf>,
    known_dirs: std::collections::HashSet<PathBuf>,
    keep: bool,
}

impl Extracted {
    /// Takes over `to`, which must be missing (created with its parents) or an empty folder.
    fn claim(to: &Path) -> Result<Self> {
        let mut extracted = Extracted {
            root: to.to_path_buf(),
            files: Vec::new(),
            dirs: Vec::new(),
            known_dirs: std::collections::HashSet::new(),
            keep: false,
        };
        match fs::symlink_metadata(to) {
            Ok(meta) if is_reparse_point(&meta) => Err(PlatformError::new(
                ErrorKind::AccessDenied,
                "The destination is a junction or symbolic link",
                Some(to),
            )),
            Ok(meta) if !meta.is_dir() => Err(PlatformError::new(
                ErrorKind::Unknown,
                "The destination already exists and is not a folder",
                Some(to),
            )),
            Ok(_) => {
                let mut entries = fs::read_dir(to).map_err(|e| PlatformError::io(e, Some(to)))?;
                if entries.next().is_some() {
                    return Err(PlatformError::new(
                        ErrorKind::Unknown,
                        "The destination folder already exists and is not empty",
                        Some(to),
                    ));
                }
                extracted.known_dirs.insert(to.to_path_buf());
                Ok(extracted)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let missing: Vec<&Path> = to
                    .ancestors()
                    .take_while(|dir| {
                        !dir.as_os_str().is_empty()
                            && matches!(fs::symlink_metadata(dir), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
                    })
                    .collect();
                for dir in missing.into_iter().rev() {
                    fs::create_dir(dir).map_err(|e| PlatformError::io(e, Some(dir)))?;
                    extracted.dirs.push(dir.to_path_buf());
                    extracted.known_dirs.insert(dir.to_path_buf());
                }
                Ok(extracted)
            }
            Err(e) => Err(PlatformError::io(e, Some(to))),
        }
    }

    /// Creates `dir` (inside the destination) one level at a time. A folder is only passed through when this
    /// extraction made it, or when an earlier entry spelled it in another case: never an unknown junction.
    fn make_dirs(&mut self, zip: &Path, entry: &str, dir: &Path) -> Result<()> {
        let relative = dir
            .strip_prefix(&self.root)
            .map_err(|_| rejected_entry(zip, entry, "path lands outside the destination"))?
            .to_path_buf();
        let mut path = self.root.clone();
        for part in relative.components() {
            path.push(part);
            if self.known_dirs.contains(&path) {
                continue;
            }
            match fs::create_dir(&path) {
                Ok(()) => self.dirs.push(path.clone()),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let real_dir = fs::symlink_metadata(&path)
                        .is_ok_and(|meta| meta.is_dir() && !is_reparse_point(&meta));
                    if !real_dir {
                        return Err(rejected_entry(
                            zip,
                            entry,
                            "its folder clashes with an earlier entry",
                        ));
                    }
                }
                Err(e) => return Err(PlatformError::io(e, Some(&path))),
            }
            self.known_dirs.insert(path.clone());
        }
        Ok(())
    }

    fn commit(mut self) {
        self.keep = true;
    }
}

impl Drop for Extracted {
    fn drop(&mut self) {
        if self.keep {
            return;
        }
        // Best effort, newest first. A scanner may hold a fresh file for a moment, so a stubborn one gets retries.
        for file in self.files.iter().rev() {
            for _ in 0..3 {
                if remove_file(file).is_ok() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
        for dir in self.dirs.iter().rev() {
            let _ = fs::remove_dir(dir);
        }
    }
}

fn is_reparse_point(meta: &fs::Metadata) -> bool {
    meta.file_attributes() & 0x400 != 0
}

/// Unpacks every entry of a zip into `to`, which must be missing or an empty folder. Entries are vetted first
/// (names, links, counts); bytes are counted as they are unpacked. Any failure removes what was extracted.
pub fn extract_zip(zip: &Path, to: &Path) -> Result<()> {
    extract_zip_limited(zip, to, ZIP_LIMITS)
}

fn extract_zip_limited(zip: &Path, to: &Path, limits: ZipLimits) -> Result<()> {
    let file = File::open(zip).map_err(|e| PlatformError::io(e, Some(zip)))?;
    let mut archive =
        zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| zip_error(e, zip, None))?;
    let plan = plan_zip_entries(&archive, zip, limits)?;
    let mut extracted = Extracted::claim(to)?;
    let mut total = 0u64;
    let mut buffer = vec![0u8; 64 * 1024];
    for item in &plan {
        let mut dest = to.to_path_buf();
        dest.extend(&item.parts);
        if dest == to || !dest.starts_with(to) {
            return Err(rejected_entry(
                zip,
                &item.name,
                "path lands outside the destination",
            ));
        }
        if item.is_dir {
            extracted.make_dirs(zip, &item.name, &dest)?;
            continue;
        }
        if let Some(parent) = dest.parent() {
            extracted.make_dirs(zip, &item.name, parent)?;
        }
        let mut entry = archive
            .by_index(item.index)
            .map_err(|e| zip_error(e, zip, Some(&item.name)))?;
        // create_new: an entry can never overwrite an earlier one, even one that differs only in case.
        // Windows reports a folder in the way as access denied, so anything already there is a clash.
        let mut out = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .map_err(|e| {
                if fs::symlink_metadata(&dest).is_ok() {
                    rejected_entry(
                        zip,
                        &item.name,
                        "a file or folder with this name was already extracted",
                    )
                } else {
                    PlatformError::io(e, Some(&dest))
                }
            })?;
        extracted.files.push(dest.clone());
        let mut written = 0u64;
        loop {
            let n = entry
                .read(&mut buffer)
                .map_err(|e| zip_error(zip::result::ZipError::Io(e), zip, Some(&item.name)))?;
            if n == 0 {
                break;
            }
            written += n as u64;
            total += n as u64;
            if written > limits.entry_bytes {
                return Err(rejected_entry(
                    zip,
                    &item.name,
                    format!("it unpacks to more than {} bytes", limits.entry_bytes),
                ));
            }
            if total > limits.total_bytes {
                return Err(rejected_entry(
                    zip,
                    &item.name,
                    format!(
                        "the archive unpacks to more than {} bytes in total",
                        limits.total_bytes
                    ),
                ));
            }
            out.write_all(&buffer[..n])
                .map_err(|e| PlatformError::io(e, Some(&dest)))?;
        }
    }
    extracted.commit();
    Ok(())
}

/// One client for every download, so the core's parallel downloads share pooled connections and TLS sessions:
/// a content version is a thousand small files, and a handshake per file used to cost more than the file.
fn download_client() -> std::result::Result<&'static reqwest::Client, reqwest::Error> {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    // No total timeout here: `download_file` bounds the whole transfer, and between chunks the read timeout applies.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(60))
        .pool_max_idle_per_host(16)
        .gzip(true)
        .redirect(crate::platform::redirect_policy())
        .user_agent(concat!("Lucent/", env!("CARGO_PKG_VERSION")))
        .build()?;
    Ok(CLIENT.get_or_init(|| client))
}

/// Progress goes to the webview at most this often; every message costs an IPC hop and a UI update.
const PROGRESS_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

/// What `download_file` accepts, counted as bytes arrive. A plugin repo is untrusted, and its zip is only checked once
/// it is on disk.
#[derive(Clone, Copy)]
struct DownloadLimits {
    bytes: u64,
    duration: std::time::Duration,
}

/// The largest content file, the 310.9.16 Neural Rendering runtime, is 276 MB, and a plugin zip over ZIP_LIMITS'
/// 256 MB couldn't be unpacked anyway. In two hours that runtime needs about 0.3 Mbit/s.
const DOWNLOAD_LIMITS: DownloadLimits = DownloadLimits {
    bytes: 1024 * 1024 * 1024,
    duration: std::time::Duration::from_secs(2 * 60 * 60),
};

pub async fn download_file(url: &str, to: &Path, progress: tauri::ipc::Channel<u64>) -> Result<()> {
    download_limited(
        url,
        to,
        |received| {
            let _ = progress.send(received);
        },
        DOWNLOAD_LIMITS,
    )
    .await
}

async fn download_limited(
    url: &str,
    to: &Path,
    mut progress: impl FnMut(u64),
    limits: DownloadLimits,
) -> Result<()> {
    let error = |e: reqwest::Error| {
        crate::platform::refused_redirect(&e).unwrap_or_else(|| {
            PlatformError::new(
                if e.status() == Some(reqwest::StatusCode::NOT_FOUND) {
                    ErrorKind::NotFound
                } else {
                    ErrorKind::Network
                },
                e.to_string(),
                None,
            )
        })
    };
    // Not `Network`: the core retries those, and a retry would only repeat the same refusal.
    let too_large = || {
        PlatformError::new(
            ErrorKind::Unknown,
            format!(
                "The download is larger than {} MB.",
                limits.bytes.div_ceil(1024 * 1024)
            ),
            None,
        )
    };
    let started = std::time::Instant::now();
    let mut response = download_client()
        .map_err(error)?
        .get(crate::platform::fetchable_url(url)?)
        .send()
        .await
        .map_err(error)?
        .error_for_status()
        .map_err(error)?;
    // A gzipped reply has no usable length, so the running count is the real limit.
    if response
        .content_length()
        .is_some_and(|length| length > limits.bytes)
    {
        return Err(too_large());
    }
    let file = temp_file(to, None)?;
    let mut writer = std::io::BufWriter::with_capacity(256 * 1024, file);
    let mut received = 0;
    let mut reported = std::time::Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(error)? {
        received += chunk.len() as u64;
        if received > limits.bytes {
            return Err(too_large());
        }
        if started.elapsed() > limits.duration {
            return Err(PlatformError::new(
                ErrorKind::Unknown,
                format!(
                    "The download didn’t finish within {} minutes.",
                    limits.duration.as_secs().div_ceil(60)
                ),
                None,
            ));
        }
        writer
            .write_all(&chunk)
            .map_err(|e| PlatformError::io(e, Some(to)))?;
        if reported.elapsed() >= PROGRESS_INTERVAL {
            progress(received);
            reported = std::time::Instant::now();
        }
    }
    progress(received);
    let file = writer
        .into_inner()
        .map_err(|e| PlatformError::io(e.into_error(), Some(to)))?;
    commit(file, to, true)
}

pub fn is_game_running() -> Result<bool> {
    is_process_running("ffxiv_dx11.exe")
}

/// True when any process runs an exe with this file name (case-insensitive).
pub fn is_process_running(name: &str) -> Result<bool> {
    any_process(|_, exe| exe.eq_ignore_ascii_case(name))
}

/// True when a process other than this one runs the exe at `path`, compared by full path: case, either slash and short
/// names don't matter. A process Lucent may not open (another account's, a protected one) counts as not running it.
pub fn is_exe_running_elsewhere(path: &Path) -> Result<bool> {
    // The final path, as Windows resolves it, makes every spelling of one file compare equal.
    let same_file = |path: &Path| {
        fs::canonicalize(path)
            .ok()
            .map(|path| path.to_string_lossy().to_lowercase())
    };
    let wanted = match fs::canonicalize(path) {
        Ok(wanted) => wanted,
        // An exe that isn't there can't be running.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(PlatformError::io(e, Some(path))),
    };
    let name = wanted
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase());
    let wanted = wanted.to_string_lossy().to_lowercase();
    let own = std::process::id();
    any_process(|id, exe| {
        id != own
            && name.as_deref() == Some(exe.to_lowercase().as_str())
            && process_image(id)
                .is_some_and(|image| same_file(&image).as_deref() == Some(wanted.as_str()))
    })
}

/// The full path of the exe process `id` runs, when Lucent may ask.
fn process_image(id: u32) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: the handle is closed before returning, and the buffer outlives the call that fills it.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, id).ok()?;
        let mut buffer = vec![0u16; 32_768];
        let mut length = buffer.len() as u32;
        let queried = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(process);
        queried.ok()?;
        Some(PathBuf::from(std::ffi::OsString::from_wide(
            &buffer[..length as usize],
        )))
    }
}

/// Walks the running processes, by id and exe file name, until `found` says yes.
fn any_process(mut found: impl FnMut(u32, &str) -> bool) -> Result<bool> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    let error =
        |e: windows::core::Error| PlatformError::new(ErrorKind::Unknown, e.to_string(), None);
    // SAFETY: the snapshot owns the enumeration; CloseHandle runs on every exit. The entry is owned.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).map_err(error)?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut next = Process32FirstW(snapshot, &mut entry);
        let mut running = false;
        while next.is_ok() {
            let len = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            if found(
                entry.th32ProcessID,
                &String::from_utf16_lossy(&entry.szExeFile[..len]),
            ) {
                running = true;
                break;
            }
            next = Process32NextW(snapshot, &mut entry);
        }
        let _ = CloseHandle(snapshot);
        if !running {
            if let Err(e) = next {
                if e.code().0 as u32 != 0x80070012 {
                    return Err(error(e));
                }
            }
        }
        Ok(running)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_the_running_test_exe_and_not_a_missing_one() {
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_string_lossy().into_owned();
        assert!(is_process_running(&name).unwrap());
        assert!(is_process_running(&name.to_uppercase()).unwrap());
        assert!(!is_process_running("lucent-no-such-process.exe").unwrap());
    }

    #[test]
    fn finds_another_process_running_an_exe_by_its_full_path_and_never_itself() {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};
        let dir = tempfile::tempdir().unwrap();
        // A copy of this test exe at a path nothing else runs, so only the child below can match it.
        let exe = dir.path().join("Lucent Test.exe");
        fs::copy(std::env::current_exe().unwrap(), &exe).unwrap();
        assert!(!is_exe_running_elsewhere(&exe).unwrap());
        let mut child = Command::new(&exe)
            .args([
                "--ignored",
                "--exact",
                "files::tests::exe_running_elsewhere_child",
                "--nocapture",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let seen_by_child = BufReader::new(child.stdout.take().unwrap())
            .lines()
            .map_while(std::result::Result::ok)
            .find(|line| line.starts_with("elsewhere="));
        let text = exe.to_str().unwrap();
        let spellings = [
            exe.clone(),
            PathBuf::from(text.to_uppercase()),
            PathBuf::from(text.replace('\\', "/")),
            dir.path().join("sub").join("..").join("Lucent Test.exe"),
        ];
        let seen_by_parent: Vec<_> = spellings
            .iter()
            .map(|path| is_exe_running_elsewhere(path).unwrap())
            .collect();
        drop(child.stdin.take());
        child.wait().unwrap();
        // The child runs that exe itself, and nothing else does.
        assert_eq!(seen_by_child.as_deref(), Some("elsewhere=false"));
        assert_eq!(seen_by_parent, [true; 4], "{spellings:?}");
        assert!(!is_exe_running_elsewhere(&exe).unwrap());
        assert!(!is_exe_running_elsewhere(&dir.path().join("Missing.exe")).unwrap());
    }

    #[test]
    #[ignore = "helper launched only by the exe-running-elsewhere test"]
    fn exe_running_elsewhere_child() {
        use std::io::Write;
        let exe = std::env::current_exe().unwrap();
        println!("elsewhere={}", is_exe_running_elsewhere(&exe).unwrap());
        std::io::stdout().flush().unwrap();
        // Stay running until the parent has looked.
        let _ = std::io::stdin().read_line(&mut String::new());
    }

    #[test]
    fn copies_binary_files_atomically_and_hashes_their_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.dll");
        let target = dir.path().join("cache").join("file");
        fs::write(&source, b"\x00\xff\x01").unwrap();
        copy_file(&source, &target, true, None).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"\x00\xff\x01");
        fs::write(&source, b"OptiScaler").unwrap();
        assert_eq!(
            hash_file(&source).unwrap(),
            "f1a59411e0090ae0608b2e78d73533a7f6ba41442589345f46631822f2dbae02"
        );
        write_text(&target, "complete replacement", None).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "complete replacement");
    }

    #[test]
    fn replaces_and_removes_readonly_files() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("ReShade.ini");
        fs::write(&target, "protected").unwrap();
        let mut permissions = fs::metadata(&target).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&target, permissions).unwrap();
        write_text(&target, "replaced", None).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "replaced");
        let mut permissions = fs::metadata(&target).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&target, permissions).unwrap();
        remove_file(&target).unwrap();
        assert!(!target.exists());
    }

    #[test]
    fn list_files_skips_junctions_and_symlinks_instead_of_failing() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path().join("game");
        let outside = dir.path().join("outside");
        fs::create_dir_all(&game).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(game.join("ffxiv_dx11.exe"), "exe").unwrap();
        fs::write(outside.join("secret.txt"), "outside").unwrap();
        // Creating a link can need a Windows privilege; the skip itself is what matters where allowed.
        if std::os::windows::fs::symlink_dir(&outside, game.join("linked")).is_err() {
            return;
        }
        let files = list_files(&game).unwrap();
        assert_eq!(files, ["ffxiv_dx11.exe"]);
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
    fn batch_primitives_keep_item_order_and_the_single_file_checks() {
        let dir = tempfile::tempdir().unwrap();
        let game = dir.path().join("game");
        fs::create_dir_all(game.join("shaders")).unwrap();
        let sources: Vec<PathBuf> = (0..40)
            .map(|i| {
                let p = dir.path().join(format!("src{i}"));
                fs::write(&p, format!("file {i}")).unwrap();
                p
            })
            .collect();
        let relatives: Vec<String> = (0..40).map(|i| format!("shaders/deep/{i}.fx")).collect();
        let targets = resolve_game_paths(&game, &relatives).unwrap();
        assert_eq!(targets[7], game.join("shaders").join("deep").join("7.fx"));
        assert!(resolve_game_paths(&game, &["ok.fx".into(), "../escape".into()]).is_err());
        let items: Vec<CopyItem> = sources
            .iter()
            .zip(&targets)
            .map(|(from, to)| CopyItem {
                from: from.clone(),
                to: to.clone(),
                replace: false,
            })
            .collect();
        copy_many(&items, None).unwrap();
        assert_eq!(
            hash_many(&targets).unwrap(),
            sources
                .iter()
                .map(|p| hash_file(p).unwrap())
                .collect::<Vec<_>>()
        );
        let stats = stat_many(&[targets[3].clone(), game.join("missing.fx")]).unwrap();
        assert_eq!(stats[0].as_ref().unwrap().size, 6);
        assert!(stats[1].is_none());
        // A copy that may not replace stops the batch with its error; the others still land atomically.
        let again: Vec<CopyItem> = items
            .iter()
            .map(|i| CopyItem {
                from: i.from.clone(),
                to: i.to.clone(),
                replace: false,
            })
            .collect();
        assert!(copy_many(&again, None).is_err());
        assert!(hash_many(&[game.join("missing.fx")]).is_err());
        remove_many(&targets).unwrap();
        assert!(stat_many(&targets).unwrap().iter().all(Option::is_none));
        remove_directories_if_empty(&[game.join("shaders").join("deep"), game.join("shaders")])
            .unwrap();
        assert!(!game.join("shaders").exists());
    }

    #[test]
    fn appends_text_in_order_and_creates_the_file_and_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("Lucent").join("lucent.log");
        append_text(&log, "first\n").unwrap();
        append_text(&log, "second\nthird\n").unwrap();
        assert_eq!(fs::read_to_string(&log).unwrap(), "first\nsecond\nthird\n");
    }

    #[test]
    fn writes_many_preallocated_bytes_with_one_flush() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("checkpoints.txt");
        fs::write(&file, "00000").unwrap();
        write_file_bytes(&file, &[0, 2, 4], b'1').unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "10101");
        assert!(write_file_bytes(&file, &[1, 5], b'1').is_err());
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
        assert_eq!(
            fs::read_to_string(full.join("My preset.ini")).unwrap(),
            "user"
        );
        let empty = dir.path().join("reshade-shaders");
        fs::create_dir(&empty).unwrap();
        remove_directory_if_empty(&empty).unwrap();
        assert!(!empty.exists());
        remove_directory_if_empty(&empty).unwrap();
    }

    #[test]
    fn rejects_windows_path_escapes_and_aliases() {
        let dir = tempfile::tempdir().unwrap();
        for path in [
            "../outside",
            "..\\outside",
            "C:\\outside",
            "\\outside",
            "folder/../outside",
            "file:stream",
            "nul.ini",
            "COM¹.dll",
            "LPT².ini",
            "folder./file",
            "file ",
        ] {
            assert!(
                resolve_game_path(dir.path(), path).is_err(),
                "accepted {path}"
            );
        }
        assert_eq!(
            resolve_game_path(dir.path(), "shaders/Example.fx").unwrap(),
            dir.path().join("shaders").join("Example.fx")
        );
    }

    #[test]
    fn rejects_a_junction_leading_outside_the_game_folder() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let link = dir.path().join("shaders");
        // Directory junctions need no developer mode or administrator privileges.
        let result = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert!(resolve_game_path(dir.path(), "shaders/Example.fx").is_err());
        fs::remove_dir(link).unwrap();
    }

    #[test]
    fn rejects_a_game_root_beneath_a_junction() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir_all(outside.path().join("XIV").join("game")).unwrap();
        let link = dir.path().join("library");
        let result = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
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
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .unwrap();
        assert_eq!(
            copy_file(&source, &target, true, None).unwrap_err().kind,
            ErrorKind::Locked
        );
        drop(held);
        assert_eq!(fs::read_to_string(&target).unwrap(), "original bytes");
        assert_eq!(
            fs::read_dir(dir.path()).unwrap().count(),
            2,
            "temporary files are removed on failure"
        );
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

    fn make_junction(link: &Path, target: &Path) {
        // Directory junctions need no developer mode or administrator privileges.
        let result = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stdout)
        );
    }

    #[test]
    fn lists_folder_names_sorted_ignoring_case_and_leaves_out_files() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["banana", "Cherry", "apple", "Äpfel", "Apple pie"] {
            fs::create_dir(dir.path().join(name)).unwrap();
        }
        fs::write(dir.path().join("aaa.txt"), "file").unwrap();
        fs::create_dir_all(dir.path().join("banana").join("nested")).unwrap();
        assert_eq!(
            list_folders(dir.path()).unwrap(),
            ["apple", "Apple pie", "banana", "Cherry", "Äpfel"]
        );
        assert!(list_folders(&dir.path().join("apple")).unwrap().is_empty());
    }

    #[test]
    fn list_folders_includes_junctions_and_leaves_out_dangling_ones() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let gone = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("plain")).unwrap();
        make_junction(&dir.path().join("linked"), elsewhere.path());
        let gone_link = dir.path().join("dangling");
        make_junction(&gone_link, gone.path());
        drop(gone);
        assert_eq!(list_folders(dir.path()).unwrap(), ["linked", "plain"]);
        fs::remove_dir(dir.path().join("linked")).unwrap();
        fs::remove_dir(gone_link).unwrap();
    }

    #[test]
    fn list_folders_reports_a_missing_root_as_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let error = list_folders(&dir.path().join("missing")).unwrap_err();
        assert_eq!(error.kind, ErrorKind::NotFound);
    }

    fn stored() -> zip::write::SimpleFileOptions {
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored)
    }

    fn deflated() -> zip::write::SimpleFileOptions {
        zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
    }

    fn write_zip_with(path: &Path, build: impl FnOnce(&mut zip::ZipWriter<File>)) {
        let mut writer = zip::ZipWriter::new(File::create(path).unwrap());
        build(&mut writer);
        writer.finish().unwrap();
    }

    /// Stored entries. A name ending in a slash is a folder entry.
    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        write_zip_with(path, |writer| {
            for (name, bytes) in entries {
                if name.ends_with('/') {
                    writer.add_directory(*name, stored()).unwrap();
                } else {
                    writer.start_file(*name, stored()).unwrap();
                    writer.write_all(bytes).unwrap();
                }
            }
        });
        // A writer that quietly "fixed" a hostile name would make a rejection test pass for the wrong reason.
        let archive = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
        let stored_names: Vec<String> = archive
            .file_names()
            .map(|name| name.unwrap().into_owned())
            .collect();
        let wanted: Vec<String> = entries.iter().map(|(name, _)| name.to_string()).collect();
        assert_eq!(stored_names, wanted);
    }

    fn limits(entries: usize, total_bytes: u64, entry_bytes: u64) -> ZipLimits {
        ZipLimits {
            entries,
            total_bytes,
            entry_bytes,
        }
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn extracts_nested_folders_and_files_into_a_new_destination() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("plugin.zip");
        write_zip(
            &zip,
            &[
                ("Plugin.json", b"{}"),
                ("lib/", b""),
                ("lib/deep/Plugin.dll", b"\x00\xff\x01"),
                ("docs/Readme.txt", b"hello"),
                ("empty/", b""),
                ("Lib/deep/Other.dll", b"cased differently"),
            ],
        );
        let to = dir.path().join("Plugins").join("Plugin");
        extract_zip(&zip, &to).unwrap();
        assert_eq!(fs::read(to.join("Plugin.json")).unwrap(), b"{}");
        assert_eq!(
            fs::read(to.join("lib").join("deep").join("Plugin.dll")).unwrap(),
            b"\x00\xff\x01"
        );
        assert_eq!(
            fs::read(to.join("lib").join("deep").join("Other.dll")).unwrap(),
            b"cased differently"
        );
        assert_eq!(
            fs::read_to_string(to.join("docs").join("Readme.txt")).unwrap(),
            "hello"
        );
        assert!(to.join("empty").is_dir());
        assert_eq!(names_in(dir.path()), ["Plugins", "plugin.zip"]);
    }

    #[test]
    fn extracts_deflated_entries_and_treats_backslashes_as_folder_separators() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("plugin.zip");
        let text = "Lucent ".repeat(20_000);
        write_zip_with(&zip, |writer| {
            writer.start_file("big.txt", deflated()).unwrap();
            writer.write_all(text.as_bytes()).unwrap();
            writer
                .start_file("old\\style\\file.txt", deflated())
                .unwrap();
            writer.write_all(b"windows tool").unwrap();
        });
        let to = dir.path().join("out");
        extract_zip(&zip, &to).unwrap();
        assert_eq!(fs::read_to_string(to.join("big.txt")).unwrap(), text);
        assert_eq!(
            fs::read_to_string(to.join("old").join("style").join("file.txt")).unwrap(),
            "windows tool"
        );
    }

    #[test]
    fn extracts_into_an_existing_empty_folder_and_an_empty_archive_leaves_it_empty() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("plugin.zip");
        let empty_zip = dir.path().join("empty.zip");
        write_zip(&zip, &[("a.txt", b"a")]);
        write_zip(&empty_zip, &[]);
        let to = dir.path().join("out");
        fs::create_dir(&to).unwrap();
        extract_zip(&empty_zip, &to).unwrap();
        assert!(names_in(&to).is_empty());
        extract_zip(&zip, &to).unwrap();
        assert_eq!(fs::read_to_string(to.join("a.txt")).unwrap(), "a");
    }

    #[test]
    fn rejects_unsafe_entry_names_before_writing_anything() {
        let hostile = [
            "../evil.txt",
            "a/../../evil.txt",
            "a/../b.txt",
            "..",
            "../evil/",
            "..\\evil.txt",
            "x\\..\\..\\evil.txt",
            "a/..\\..\\evil.txt",
            "/abs.txt",
            "/abs/dir/",
            "\\abs.txt",
            "C:/evil.txt",
            "C:evil.txt",
            "c:\\evil\\",
            "\\\\?\\C:\\evil.txt",
            "\\\\server\\share\\evil.txt",
            "dir/evil.txt:stream",
            "evil.txt::$DATA",
            "sub/C:/evil.txt",
            "nul",
            "NUL.txt",
            "con.tar.gz",
            "dir/aux/file.txt",
            "dir/PRN.dll",
            "com1",
            "Lpt9.dll",
            "COM\u{b9}.dll",
            "con .txt",
            "trailing./file.txt",
            "dir./",
            "space /file.txt",
            "a. /b.txt",
            "name.",
            "bad<name>.txt",
            "what?.txt",
            "pipe|.txt",
            "star*.txt",
            "quote\".txt",
            "tab\there.txt",
            "nul\0.txt",
            "./dot.txt",
            "a/./b.txt",
            "a//b.txt",
        ];
        for name in hostile {
            let dir = tempfile::tempdir().unwrap();
            let zip = dir.path().join("in.zip");
            write_zip(&zip, &[("ok.txt", b"fine"), (name, b"evil")]);
            let to = dir.path().join("outer").join("out");
            let error = extract_zip(&zip, &to).unwrap_err();
            assert_eq!(error.kind, ErrorKind::Unknown, "{name:?}");
            assert!(
                error.message.contains("rejected") && error.message.contains(name),
                "{name:?}: {}",
                error.message
            );
            assert_eq!(
                names_in(dir.path()),
                ["in.zip"],
                "{name:?} left files behind"
            );
        }
    }

    #[test]
    fn accepts_names_that_only_look_unusual() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("in.zip");
        write_zip(
            &zip,
            &[
                ("console.txt", b"1"),
                ("com10.txt", b"2"),
                ("aux2/lptx.txt", b"3"),
                (".hidden", b"4"),
                ("spaced name/file name.txt", b"5"),
                ("v1.2.3/lib-1.0..dll", b"6"),
                ("Ünïcødé/файл.txt", b"7"),
            ],
        );
        let to = dir.path().join("out");
        extract_zip(&zip, &to).unwrap();
        assert_eq!(
            fs::read(to.join("v1.2.3").join("lib-1.0..dll")).unwrap(),
            b"6"
        );
        assert_eq!(fs::read(to.join("Ünïcødé").join("файл.txt")).unwrap(), b"7");
    }

    #[test]
    fn rejects_symbolic_link_entries() {
        for link_name in ["link", "nested/link"] {
            let dir = tempfile::tempdir().unwrap();
            let zip = dir.path().join("in.zip");
            write_zip_with(&zip, |writer| {
                writer.start_file("ok.txt", stored()).unwrap();
                writer.write_all(b"fine").unwrap();
                writer
                    .add_symlink(link_name, "..\\..\\secret.txt", stored())
                    .unwrap();
            });
            let to = dir.path().join("out");
            let error = extract_zip(&zip, &to).unwrap_err();
            assert_eq!(error.kind, ErrorKind::Unknown);
            assert!(
                error.message.contains(link_name) && error.message.contains("symbolic link"),
                "{}",
                error.message
            );
            assert_eq!(names_in(dir.path()), ["in.zip"]);
        }
    }

    #[test]
    fn caps_the_number_of_entries() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("in.zip");
        write_zip(
            &zip,
            &[("a", b"1"), ("b/", b""), ("b/c", b"2"), ("d", b"3")],
        );
        let to = dir.path().join("out");
        let error = extract_zip_limited(&zip, &to, limits(3, 1000, 1000)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Unknown);
        assert!(error.message.contains("4 entries"), "{}", error.message);
        assert_eq!(names_in(dir.path()), ["in.zip"]);
        extract_zip_limited(&zip, &to, limits(4, 1000, 1000)).unwrap();
        assert_eq!(fs::read_to_string(to.join("b").join("c")).unwrap(), "2");
        assert_eq!(ZIP_LIMITS.entries, 4_000);
        assert_eq!(ZIP_LIMITS.total_bytes, 256 * 1024 * 1024);
        assert_eq!(ZIP_LIMITS.entry_bytes, 128 * 1024 * 1024);
    }

    #[test]
    fn caps_each_entry_by_counting_unpacked_bytes_and_removes_the_partial_result() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("in.zip");
        write_zip_with(&zip, |writer| {
            writer.start_file("small/first.bin", deflated()).unwrap();
            writer.write_all(&[7u8; 100]).unwrap();
            writer.start_file("exact.bin", deflated()).unwrap();
            writer.write_all(&[8u8; 1000]).unwrap();
            writer.start_file("small/bomb.bin", deflated()).unwrap();
            writer.write_all(&vec![0u8; 1001]).unwrap();
        });
        let to = dir.path().join("out");
        let error = extract_zip_limited(&zip, &to, limits(10, 10_000, 1000)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Unknown);
        assert!(
            error.message.contains("small/bomb.bin") && error.message.contains("1000 bytes"),
            "{}",
            error.message
        );
        assert_eq!(
            names_in(dir.path()),
            ["in.zip"],
            "the destination is removed"
        );
        // Exactly at the limit is fine.
        let ok_zip = dir.path().join("ok.zip");
        write_zip_with(&ok_zip, |writer| {
            writer.start_file("exact.bin", deflated()).unwrap();
            writer.write_all(&[8u8; 1000]).unwrap();
        });
        extract_zip_limited(&ok_zip, &to, limits(10, 1000, 1000)).unwrap();
        assert_eq!(fs::metadata(to.join("exact.bin")).unwrap().len(), 1000);
    }

    #[test]
    fn caps_the_whole_archive_by_counting_unpacked_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("in.zip");
        write_zip_with(&zip, |writer| {
            for name in ["one", "two", "three"] {
                writer.start_file(name, deflated()).unwrap();
                writer.write_all(&[1u8; 600]).unwrap();
            }
        });
        let to = dir.path().join("out");
        let error = extract_zip_limited(&zip, &to, limits(10, 1500, 1000)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Unknown);
        assert!(
            error.message.contains("three") && error.message.contains("1500 bytes"),
            "{}",
            error.message
        );
        assert_eq!(names_in(dir.path()), ["in.zip"]);
        extract_zip_limited(&zip, &to, limits(10, 1800, 1000)).unwrap();
    }

    #[test]
    fn refuses_a_destination_that_is_not_empty_and_leaves_it_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("in.zip");
        write_zip(&zip, &[("new.txt", b"new"), ("mine.txt", b"from the zip")]);
        let to = dir.path().join("out");
        fs::create_dir_all(to.join("keep")).unwrap();
        fs::write(to.join("mine.txt"), "player data").unwrap();
        let error = extract_zip(&zip, &to).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Unknown);
        assert!(error.message.contains("not empty"), "{}", error.message);
        assert_eq!(names_in(&to), ["keep", "mine.txt"]);
        assert_eq!(
            fs::read_to_string(to.join("mine.txt")).unwrap(),
            "player data"
        );
        // A file is not a folder either, and stays as it was.
        let file = dir.path().join("file");
        fs::write(&file, "data").unwrap();
        let error = extract_zip(&zip, &file).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Unknown);
        assert_eq!(fs::read_to_string(&file).unwrap(), "data");
    }

    #[test]
    fn refuses_a_destination_that_is_a_junction() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let zip = dir.path().join("in.zip");
        write_zip(&zip, &[("new.txt", b"new")]);
        let link = dir.path().join("out");
        make_junction(&link, elsewhere.path());
        let error = extract_zip(&zip, &link).unwrap_err();
        assert_eq!(error.kind, ErrorKind::AccessDenied);
        assert!(names_in(elsewhere.path()).is_empty());
        fs::remove_dir(link).unwrap();
    }

    #[test]
    fn removes_everything_extracted_when_a_later_entry_fails() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("in.zip");
        write_zip(
            &zip,
            &[
                ("first/", b""),
                ("first/a.txt", b"AAAAAAAAAAAAAAAA"),
                ("second/b.txt", b"BBBBBBBBBBBBBBBB"),
                ("third.txt", b"third"),
            ],
        );
        // Flip a byte of the second file's stored data: its checksum no longer matches.
        let mut bytes = fs::read(&zip).unwrap();
        let at = bytes
            .windows(16)
            .position(|window| window == b"BBBBBBBBBBBBBBBB")
            .unwrap();
        bytes[at + 4] ^= 0xff;
        fs::write(&zip, bytes).unwrap();
        let to = dir.path().join("outer").join("out");
        let error = extract_zip(&zip, &to).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Unknown);
        assert!(error.message.contains("second/b.txt"), "{}", error.message);
        assert_eq!(
            names_in(dir.path()),
            ["in.zip"],
            "parents made for the destination go too"
        );
        // Into a folder that was already there: it stays, empty.
        fs::create_dir(to.parent().unwrap()).unwrap();
        fs::create_dir(&to).unwrap();
        assert!(extract_zip(&zip, &to).is_err());
        assert!(to.is_dir());
        assert!(names_in(&to).is_empty());
    }

    #[test]
    fn removes_everything_extracted_when_entries_clash() {
        for clash in [
            ("a.txt", "A.TXT"),
            ("same", "same/inside.txt"),
            ("folder/inner.txt", "folder"),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let zip = dir.path().join("in.zip");
            write_zip(
                &zip,
                &[
                    ("first.txt", b"first"),
                    (clash.0, b"one"),
                    (clash.1, b"two"),
                ],
            );
            let to = dir.path().join("out");
            let error = extract_zip(&zip, &to).unwrap_err();
            assert_eq!(error.kind, ErrorKind::Unknown, "{clash:?}");
            assert!(
                error.message.contains(clash.1),
                "{clash:?}: {}",
                error.message
            );
            assert_eq!(names_in(dir.path()), ["in.zip"], "{clash:?}");
        }
    }

    #[test]
    fn reports_a_missing_zip_as_not_found_and_a_bad_one_as_unknown() {
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("out");
        let error = extract_zip(&dir.path().join("missing.zip"), &to).unwrap_err();
        assert_eq!(error.kind, ErrorKind::NotFound);
        let garbage = dir.path().join("garbage.zip");
        fs::write(&garbage, b"this is not a zip archive at all, just text").unwrap();
        let error = extract_zip(&garbage, &to).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Unknown);
        assert!(error.message.contains("zip"), "{}", error.message);
        let good = dir.path().join("good.zip");
        write_zip(&good, &[("a.txt", b"a"), ("b.txt", b"b")]);
        let bytes = fs::read(&good).unwrap();
        let truncated = dir.path().join("truncated.zip");
        fs::write(&truncated, &bytes[..bytes.len() / 2]).unwrap();
        assert_eq!(
            extract_zip(&truncated, &to).unwrap_err().kind,
            ErrorKind::Unknown
        );
        assert!(!to.exists());
    }

    fn text(path: &Path) -> String {
        path.to_str().unwrap().to_owned()
    }

    /// Refused for how it is written, before the file system is asked anything.
    fn refused_by_name(path: &str) {
        let error = validate_open_folder(path).expect_err(&format!("{path:?} must be refused"));
        assert_eq!(
            error.kind,
            ErrorKind::AccessDenied,
            "{path:?}: {}",
            error.message
        );
    }

    #[test]
    fn free_space_reads_the_drive_from_the_nearest_folder_that_exists() {
        let dir = tempfile::tempdir().unwrap();
        let free = free_space(dir.path()).unwrap();
        assert!(free > 0, "a temp folder's drive has room");
        // A deployment's folders may not exist yet: the space is read from the folder above them that does.
        let missing = dir.path().join("Lucent").join("deployments").join("cache");
        let walked = free_space(&missing).unwrap();
        assert!(walked > 0);
        // Other programs write meanwhile, so the two readings only have to be close.
        assert!(
            free.abs_diff(walked) < 1024 * 1024 * 1024,
            "{free} and {walked}"
        );
        assert!(!missing.exists(), "reading the space creates nothing");
        let file = dir.path().join("lucent.log");
        fs::write(&file, "log").unwrap();
        assert!(free_space(&file.join("child")).unwrap() > 0);
    }

    #[test]
    fn free_space_refuses_a_path_that_is_not_on_a_local_drive() {
        let dir = tempfile::tempdir().unwrap();
        let local = text(dir.path());
        for path in [
            String::new(),
            r"\\server\share\Lucent".to_owned(),
            format!(r"\\?\{local}"),
            r"Games\XIV".to_owned(),
            local[2..].to_owned(),
            format!("{}{}", &local[..2], &local[3..]),
        ] {
            assert!(
                free_space(Path::new(&path)).is_err(),
                "{path:?} must be refused"
            );
        }
        // A drive letter with nothing behind it has no folder to read the space from.
        let unused = ('D'..='Z')
            .rev()
            .find(|letter| !Path::new(&format!(r"{letter}:\")).exists());
        if let Some(letter) = unused {
            let error = free_space(Path::new(&format!(r"{letter}:\Games\XIV"))).unwrap_err();
            assert_eq!(error.kind, ErrorKind::NotFound, "{}", error.message);
        }
    }

    #[test]
    fn open_folder_accepts_an_existing_local_folder_as_it_is_named() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("FINAL FANTASY XIV Online");
        fs::create_dir(&folder).unwrap();
        assert_eq!(validate_open_folder(&text(&folder)).unwrap(), folder);
        assert_eq!(validate_open_folder(&text(dir.path())).unwrap(), dir.path());
    }

    #[test]
    fn open_folder_refuses_every_path_that_is_not_drive_letter_colon_backslash() {
        let dir = tempfile::tempdir().unwrap();
        let local = text(dir.path());
        let after_drive = &local[2..];
        for path in [
            String::new(),
            // Network shares, and both device namespaces, even when they name the same local folder.
            r"\\server\share".to_owned(),
            r"\\server\share\Lucent".to_owned(),
            "//server/share".to_owned(),
            format!(r"\\?\{local}"),
            format!(r"\\.\{local}"),
            r"\\?\UNC\server\share".to_owned(),
            r"\\localhost\C$\Windows".to_owned(),
            // Relative to the current folder, to the current drive's root, or to the drive's current folder.
            "Games".to_owned(),
            r"Games\XIV".to_owned(),
            r".\Games".to_owned(),
            after_drive.to_owned(),
            format!("{}{}", &local[..2], &after_drive[1..]),
            "C:".to_owned(),
            // A drive's root names no folder Lucent shows.
            r"C:\".to_owned(),
            // Only a letter, a colon and a backslash start the path.
            format!("{}/{}", &local[..2], &after_drive[1..]),
            r"1:\Games".to_owned(),
        ] {
            refused_by_name(&path);
        }
    }

    #[test]
    fn open_folder_refuses_dot_and_dot_dot_even_when_they_lead_to_a_real_folder() {
        let dir = tempfile::tempdir().unwrap();
        let inner = dir.path().join("inner");
        fs::create_dir(&inner).unwrap();
        let local = text(dir.path());
        for path in [
            format!(r"{local}\inner\.."),
            format!(r"{local}\inner\..\inner"),
            format!(
                r"{local}\..\{}",
                dir.path().file_name().unwrap().to_str().unwrap()
            ),
            format!(r"{local}\.\inner"),
            format!(r"{local}\inner\."),
            format!("{local}/inner/.."),
        ] {
            refused_by_name(&path);
        }
    }

    #[test]
    fn open_folder_refuses_streams_wildcards_devices_and_control_characters() {
        let dir = tempfile::tempdir().unwrap();
        let local = text(dir.path());
        for path in [
            // The directory's own index stream opens as the folder itself.
            format!("{local}::$INDEX_ALLOCATION"),
            format!(r"{local}\inner:stream"),
            format!(r"{local}\*"),
            format!(r"{local}\in?er"),
            format!("{local}\\\"quoted\""),
            format!(r"{local}\CON"),
            format!(r"{local}\nul.txt"),
            format!("{local}\0"),
            format!("{local}\0\\..\\..\\Windows"),
            format!("{local}\r\ncalc"),
            format!("{local}\\"),
            format!(r"{local}\\inner"),
            format!(r"{local}\inner."),
            format!(r"{local}\inner "),
        ] {
            refused_by_name(&path);
        }
    }

    #[test]
    fn open_folder_refuses_a_file_and_a_missing_folder() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("lucent.log");
        fs::write(&file, "log").unwrap();
        assert_eq!(
            validate_open_folder(&text(&file)).unwrap_err().kind,
            ErrorKind::Unknown
        );
        let exe = dir.path().join("Lucent.exe");
        fs::write(&exe, "MZ").unwrap();
        assert_eq!(
            validate_open_folder(&text(&exe)).unwrap_err().kind,
            ErrorKind::Unknown
        );
        let missing = validate_open_folder(&text(&dir.path().join("gone"))).unwrap_err();
        assert_eq!(missing.kind, ErrorKind::NotFound);
    }

    #[test]
    fn open_folder_refuses_a_junction_and_a_symbolic_link_but_not_a_folder_inside_one() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        fs::create_dir(elsewhere.path().join("inner")).unwrap();
        let junction = dir.path().join("junction");
        make_junction(&junction, elsewhere.path());
        let refused = validate_open_folder(&text(&junction)).map_err(|e| e.kind);
        // Only the final name is checked: a folder under a junction is a plain folder.
        let inside = validate_open_folder(&text(&junction.join("inner"))).is_ok();
        fs::remove_dir(&junction).unwrap();
        assert_eq!(
            refused,
            Err(ErrorKind::AccessDenied),
            "a junction must be refused"
        );
        assert!(inside);
        // Creating a symbolic link can need a Windows privilege; the refusal is what matters where allowed.
        let link = dir.path().join("link");
        if std::os::windows::fs::symlink_dir(elsewhere.path(), &link).is_ok() {
            let refused = validate_open_folder(&text(&link)).map_err(|e| e.kind);
            fs::remove_dir(&link).unwrap();
            assert_eq!(
                refused,
                Err(ErrorKind::AccessDenied),
                "a symbolic link must be refused"
            );
        }
    }
}
