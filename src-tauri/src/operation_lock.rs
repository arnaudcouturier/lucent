//! A lease for shared Lucent data. Windows closes the exclusive handle after a crash,
//! and a file handle can be released from any thread, unlike a Windows mutex.
use crate::platform::{ErrorKind, PlatformError, Result};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::os::windows::fs::OpenOptionsExt;
use std::path::Path;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    LazyLock, Mutex,
};

#[derive(Default)]
struct OperationLocks {
    leases: Mutex<HashMap<String, File>>,
    next_token: AtomicU64,
}

static LOCKS: LazyLock<OperationLocks> = LazyLock::new(OperationLocks::default);

impl OperationLocks {
    fn acquire(&self, data_folder: &Path) -> Result<String> {
        if !data_folder.is_absolute() {
            return Err(PlatformError::new(
                ErrorKind::Unknown,
                "Lucent data folder must be an absolute path",
                Some(data_folder),
            ));
        }
        fs::create_dir_all(data_folder)
            .map_err(|error| PlatformError::io(error, Some(data_folder)))?;
        let path = data_folder.join("operation.lock");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .share_mode(0)
            .open(&path)
            .map_err(|error| {
                let mut error = PlatformError::io(error, Some(&path));
                if error.kind == ErrorKind::Locked {
                    error.message =
                        "Another Lucent window is working with files. Try again when it finishes."
                            .into();
                }
                error
            })?;
        let token = format!(
            "{}-{}",
            std::process::id(),
            self.next_token.fetch_add(1, Ordering::Relaxed)
        );
        self.leases
            .lock()
            .map_err(|_| {
                PlatformError::new(
                    ErrorKind::Unknown,
                    "Lucent operation lock state is unavailable",
                    None,
                )
            })?
            .insert(token.clone(), file);
        Ok(token)
    }

    fn release(&self, token: &str) -> Result<()> {
        let file = self
            .leases
            .lock()
            .map_err(|_| {
                PlatformError::new(
                    ErrorKind::Unknown,
                    "Lucent operation lock state is unavailable",
                    None,
                )
            })?
            .remove(token)
            .ok_or_else(|| {
                PlatformError::new(
                    ErrorKind::Unknown,
                    "Lucent operation lease is not held by this process",
                    None,
                )
            })?;
        drop(file);
        Ok(())
    }

    fn release_all(&self) -> Result<()> {
        self.leases
            .lock()
            .map_err(|_| {
                PlatformError::new(
                    ErrorKind::Unknown,
                    "Lucent operation lock state is unavailable",
                    None,
                )
            })?
            .clear();
        Ok(())
    }
}

/// The core passes the original player's data folder, including after an elevated relaunch.
pub fn acquire(data_folder: &Path) -> Result<String> {
    LOCKS.acquire(data_folder)
}
pub fn release(token: &str) -> Result<()> {
    LOCKS.release(token)
}

/// Drops every lease this process holds. A webview reload orphans the old context's tokens;
/// the fresh context calls this once at startup. Other processes keep their leases.
pub fn release_all() -> Result<()> {
    LOCKS.release_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::sync::Arc;

    #[test]
    fn independent_instances_contend_for_the_same_data_folder_and_release_on_any_thread() {
        let folder = tempfile::tempdir().unwrap();
        let first = Arc::new(OperationLocks::default());
        let second = OperationLocks::default();
        let token = first.acquire(folder.path()).unwrap();
        assert_eq!(
            second.acquire(folder.path()).unwrap_err().kind,
            ErrorKind::Locked
        );
        assert!(first.release("unrecognized").is_err());
        assert_eq!(
            second.acquire(folder.path()).unwrap_err().kind,
            ErrorKind::Locked
        );
        let other_thread = first.clone();
        std::thread::spawn(move || other_thread.release(&token))
            .join()
            .unwrap()
            .unwrap();
        let next = second.acquire(folder.path()).unwrap();
        second.release(&next).unwrap();
        assert!(folder.path().join("operation.lock").is_file());
    }

    #[test]
    fn release_all_frees_this_process_leases_so_a_reloaded_webview_can_work_again() {
        let folder = tempfile::tempdir().unwrap();
        let locks = OperationLocks::default();
        let _orphaned = locks.acquire(folder.path()).unwrap();
        assert_eq!(
            OperationLocks::default()
                .acquire(folder.path())
                .unwrap_err()
                .kind,
            ErrorKind::Locked
        );
        locks.release_all().unwrap();
        let next = OperationLocks::default();
        let token = next.acquire(folder.path()).unwrap();
        next.release(&token).unwrap();
    }

    #[test]
    fn separate_player_data_folders_do_not_contend() {
        let folder = tempfile::tempdir().unwrap();
        let locks = OperationLocks::default();
        let first = locks.acquire(&folder.path().join("player")).unwrap();
        let second = locks.acquire(&folder.path().join("other-player")).unwrap();
        locks.release(&first).unwrap();
        locks.release(&second).unwrap();
        assert!(locks.acquire(Path::new("relative")).is_err());
    }

    #[test]
    fn windows_releases_the_lease_after_its_owning_process_is_killed() {
        let folder = tempfile::tempdir().unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "operation_lock::tests::operation_lock_child",
                "--nocapture",
            ])
            .env("LUCENT_TEST_OPERATION_FOLDER", folder.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap());
        let mut ready = false;
        for _ in 0..20 {
            let mut line = String::new();
            if output.read_line(&mut line).unwrap() == 0 {
                break;
            }
            if line.contains("operation-lock-held") {
                ready = true;
                break;
            }
        }
        let locks = OperationLocks::default();
        let blocked = ready && locks.acquire(folder.path()).unwrap_err().kind == ErrorKind::Locked;
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(ready, "the helper process did not acquire its lease");
        assert!(
            blocked,
            "the helper process did not exclude another instance"
        );
        let token = locks.acquire(folder.path()).unwrap();
        locks.release(&token).unwrap();
    }

    #[test]
    #[ignore = "helper launched only by the cross-process operation lease test"]
    fn operation_lock_child() {
        let folder =
            std::env::var_os("LUCENT_TEST_OPERATION_FOLDER").expect("helper needs its data folder");
        let locks = OperationLocks::default();
        let _token = locks.acquire(Path::new(&folder)).unwrap();
        println!("operation-lock-held");
        std::io::stdout().flush().unwrap();
        let mut line = String::new();
        std::io::stdin().read_line(&mut line).unwrap();
    }
}
