// Materialize an explicitly opened remote file without modifying the server.
use super::{browse::check_path, file, manager, Remotes};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime},
};
use tauri::{Emitter, Manager, Webview};
use tokio::{io::AsyncWriteExt, sync::watch};

const RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const MAX_JOBS: usize = 4;

#[derive(Clone, Default)]
pub(crate) struct OpenJobs(Arc<Mutex<HashMap<String, watch::Sender<bool>>>>);
impl OpenJobs {
    pub(crate) fn cancel_all(&self) {
        if let Ok(jobs) = self.0.lock() {
            for sender in jobs.values() {
                sender.send_replace(true);
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Update {
    id: String,
    state: &'static str,
    done: u64,
    total: u64,
    error: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Completed {
    filename: String,
    size: u64,
    sha256: String,
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("remote-open"))
        .map_err(|_| "Could not locate the local temporary folder.".into())
}

fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

fn local_name(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or("file");
    let name: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let name = name.trim_end_matches([' ', '.']);
    // Keep a useful extension when a remote name exceeds Windows' filename limit.
    let (base, extension) = match name.rsplit_once('.') {
        Some((base, ext)) if !base.is_empty() && ext.encode_utf16().count() <= 32 => {
            (base, &name[base.len()..])
        }
        _ => (name, ""),
    };
    let mut units = 0;
    let budget = 180 - extension.encode_utf16().count();
    let name = format!(
        "{}{}",
        base.chars()
            .take_while(|c| {
                units += c.len_utf16();
                units <= budget
            })
            .collect::<String>(),
        extension
    );
    let name = name.trim_end_matches([' ', '.']);
    let stem = name.split('.').next().unwrap_or("");
    if name.eq_ignore_ascii_case("completed.json") || name.eq_ignore_ascii_case("download.partial")
    {
        return format!("_{name}");
    }
    if name.is_empty()
        || matches!(
            stem.to_ascii_uppercase().as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
    {
        format!("_{name}")
    } else {
        name.to_owned()
    }
}

struct Staging {
    directory: PathBuf,
    retained: bool,
}
impl Drop for Staging {
    fn drop(&mut self) {
        if !self.retained {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }
}

fn emit(app: &tauri::AppHandle, update: Update) {
    let _ = app.emit_to("main", "remote-open-progress", update);
}

async fn run(
    app: tauri::AppHandle,
    remotes: Remotes,
    profile: String,
    session: u32,
    path: String,
    id: String,
    mut cancel: watch::Receiver<bool>,
) {
    let mut done = 0u64;
    let mut total = 0u64;
    let result: Result<PathBuf, String> = async {
        let metadata = remotes.read_range(&profile, session, &path, 0, 0).await?;
        total = metadata.size;
        let base = root(&app)?;
        tokio::fs::create_dir_all(&base)
            .await
            .map_err(|e| format!("Could not create temporary folder: {e}"))?;
        let directory = base.join(&id);
        tokio::fs::create_dir(&directory)
            .await
            .map_err(|e| format!("Could not create temporary folder: {e}"))?;
        let mut staging = Staging {
            directory: directory.clone(),
            retained: false,
        };
        let filename = local_name(&path);
        let partial = directory.join("download.partial");
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)
            .await
            .map_err(|e| format!("Could not create local copy: {e}"))?;
        let mut hash = Sha256::new();
        emit(
            &app,
            Update {
                id: id.clone(),
                state: "downloading",
                done,
                total,
                error: None,
            },
        );
        while done < total {
            if *cancel.borrow_and_update() {
                return Err("Cancelled".into());
            }
            let length = (total - done).min(file::MAX_READ as u64) as usize;
            let chunk = remotes
                .read_range(&profile, session, &path, done, length)
                .await?;
            if chunk.size != metadata.size
                || chunk.modified != metadata.modified
                || chunk.bytes.len() != length
            {
                return Err("The remote file changed while downloading.".into());
            }
            file.write_all(&chunk.bytes)
                .await
                .map_err(|e| format!("Could not write local copy: {e}"))?;
            hash.update(&chunk.bytes);
            done += chunk.bytes.len() as u64;
            emit(
                &app,
                Update {
                    id: id.clone(),
                    state: "downloading",
                    done,
                    total,
                    error: None,
                },
            );
        }
        if *cancel.borrow_and_update() {
            return Err("Cancelled".into());
        }
        let final_metadata = remotes
            .read_range(&profile, session, &path, total, 0)
            .await?;
        if final_metadata.size != metadata.size || final_metadata.modified != metadata.modified {
            return Err("The remote file changed while downloading.".into());
        }
        if *cancel.borrow_and_update() {
            return Err("Cancelled".into());
        }
        file.flush()
            .await
            .map_err(|e| format!("Could not finish local copy: {e}"))?;
        drop(file);
        let target = directory.join(&filename);
        tokio::fs::rename(&partial, &target)
            .await
            .map_err(|e| format!("Could not finish local copy: {e}"))?;
        let record = Completed {
            filename,
            size: total,
            sha256: format!("{:x}", hash.finalize()),
        };
        let serialized = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
        tokio::fs::write(directory.join("completed.json"), serialized)
            .await
            .map_err(|e| e.to_string())?;
        if *cancel.borrow_and_update() {
            return Err("Cancelled".into());
        }
        emit(
            &app,
            Update {
                id: id.clone(),
                state: "opening",
                done,
                total,
                error: None,
            },
        );
        let open_path = target.to_string_lossy().into_owned();
        tokio::task::spawn_blocking(move || crate::services::opener::open_path(open_path))
            .await
            .map_err(|_| "Could not open the local copy.".to_owned())??;
        staging.retained = true;
        Ok(target)
    }
    .await;
    report_open_copy(&app.state(), &id, &profile, &path, &result);
    let (state, error) = match result {
        Ok(_) => ("done", None),
        Err(error) if error == "Cancelled" => ("cancelled", None),
        Err(error) => ("failed", Some(error)),
    };
    emit(
        &app,
        Update {
            id: id.clone(),
            state,
            done,
            total,
            error,
        },
    );
    if let Ok(mut jobs) = app.state::<OpenJobs>().0.lock() {
        jobs.remove(&id);
    }
}

// Download & open retains the user's local copy only after the native opener succeeds.
fn report_open_copy(
    events: &crate::services::operation_events::OperationEvents,
    id: &str,
    profile: &str,
    path: &str,
    result: &Result<PathBuf, String>,
) {
    use super::direct_events::{finish, DirectTransfer};
    let outcome = match result {
        Ok(target) => DirectTransfer::Downloaded(target),
        Err(error) if error == "Cancelled" => DirectTransfer::Cancelled,
        Err(_) => DirectTransfer::Failed,
    };
    finish(
        events,
        Some(id),
        profile,
        path,
        crate::services::operation_events::EntryKind::File,
        outcome,
    );
}

#[tauri::command]
pub(crate) fn remote_start_open(
    webview: Webview,
    id: String,
    profile_id: String,
    session_id: u32,
    path: String,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Invalid open request.".into());
    }
    check_path(&path, false).map_err(|e| e.message().to_owned())?;
    let remotes = manager(&webview)?;
    remotes.current(&profile_id, Some(session_id))?;
    let jobs = webview.state::<OpenJobs>().inner().clone();
    let (sender, receiver) = watch::channel(false);
    {
        let mut active = jobs.0.lock().map_err(|_| "Could not start the download.")?;
        if active.len() >= MAX_JOBS || active.contains_key(&id) {
            return Err("Too many files are opening.".into());
        }
        active.insert(id.clone(), sender);
    }
    let app = webview.app_handle().clone();
    tauri::async_runtime::spawn(run(
        app, remotes, profile_id, session_id, path, id, receiver,
    ));
    Ok(())
}

#[tauri::command]
pub(crate) fn remote_cancel_open(webview: Webview, id: String) -> Result<(), String> {
    manager(&webview)?;
    let jobs = webview.state::<OpenJobs>();
    let active = jobs
        .0
        .lock()
        .map_err(|_| "Could not cancel the download.")?;
    if let Some(sender) = active.get(&id) {
        sender.send_replace(true);
    }
    Ok(())
}

// Clean old, unchanged copies and abandoned partial downloads. Edited copies survive.
pub(crate) fn cleanup(app: &tauri::AppHandle) {
    let Ok(base) = root(app) else {
        return;
    };
    cleanup_at(&base, SystemTime::now());
}

fn cleanup_at(base: &std::path::Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !valid_id(&name)
            || !entry
                .file_type()
                .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
        {
            continue;
        }
        let dir = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta
            .modified()
            .ok()
            .and_then(|time| now.duration_since(time).ok())
            .is_some_and(|age| age >= RETENTION)
        {
            continue;
        }
        let marker = dir.join("completed.json");
        let record = fs::read(&marker)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Completed>(&bytes).ok());
        if let Some(record) = record {
            if local_name(&record.filename) != record.filename {
                continue;
            }
            // External applications may have created sidecar files. Never remove them.
            let Ok(contents) = fs::read_dir(&dir) else {
                continue;
            };
            if contents.into_iter().any(|entry| match entry {
                Ok(entry) => {
                    entry.file_name() != "completed.json"
                        && entry.file_name() != std::ffi::OsStr::new(&record.filename)
                }
                Err(_) => true,
            }) {
                continue;
            }
            let path = dir.join(&record.filename);
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() != record.size
            {
                continue;
            }
            let Ok(mut file) = fs::File::open(&path) else {
                continue;
            };
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 65536];
            loop {
                match file.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => hash.update(&buffer[..count]),
                    Err(_) => {
                        hash = Sha256::new();
                        break;
                    }
                }
            }
            if format!("{:x}", hash.finalize()) != record.sha256 {
                continue;
            }
            drop(file);
            if fs::remove_file(path).is_ok() {
                let _ = fs::remove_file(marker);
                let _ = fs::remove_dir(dir);
            }
        } else if !marker.exists() {
            let partial = dir.join("download.partial");
            if fs::symlink_metadata(&partial)
                .is_ok_and(|m| m.is_file() && !m.file_type().is_symlink())
            {
                let _ = fs::remove_file(partial);
            }
            let _ = fs::remove_dir(dir);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_and_open_reports_only_a_retained_local_copy() {
        use crate::services::operation_events::{
            testing::Observed, EntryKind, ItemChange, Location, OperationEvents, TransferCounts,
            TransferOutcome,
        };
        let events = OperationEvents::default();
        let mut observed = Observed::subscribe(&events);
        let target = PathBuf::from(r"C:\temp\_bad_name.txt");
        let remote = "/data/bad:name.txt";
        report_open_copy(&events, "open", "host-id", remote, &Ok(target.clone()));
        observed.item(
            Some("open"),
            EntryKind::File,
            ItemChange::Copied {
                source: Location::sftp("host-id", remote),
                destination: Location::Local(target),
            },
        );
        observed.terminal(
            "open",
            TransferOutcome::Completed,
            TransferCounts {
                copied: 1,
                ..Default::default()
            },
        );
        report_open_copy(&events, "open", "host-id", remote, &Err("Cancelled".into()));
        observed.terminal(
            "open",
            TransferOutcome::Cancelled,
            TransferCounts::default(),
        );
        report_open_copy(
            &events,
            "open",
            "host-id",
            remote,
            &Err("opener failed".into()),
        );
        observed.terminal(
            "open",
            TransferOutcome::Failed,
            TransferCounts {
                failed: 1,
                ..Default::default()
            },
        );
    }

    #[test]
    fn safe_names_keep_extensions_and_avoid_windows_collisions() {
        assert_eq!(local_name("/a/completed.json"), "_completed.json");
        assert_eq!(local_name("/a/download.partial"), "_download.partial");
        assert_eq!(local_name("/a/CON.txt"), "_CON.txt");
        assert_eq!(local_name("/a/bad:name.txt"), "bad_name.txt");
        let long = local_name(&format!("/a/{}.txt", "a".repeat(220)));
        assert!(long.ends_with(".txt"));
        assert_eq!(long.encode_utf16().count(), 180);
    }

    #[test]
    fn cleanup_removes_expired_unedited_copies_and_preserves_edits() {
        let mut random = [0; 16];
        getrandom::fill(&mut random).unwrap();
        let base = std::env::temp_dir().join(format!(
            "stratum-open-test-{:032x}",
            u128::from_le_bytes(random)
        ));
        let unchanged = base.join("11111111-1111-1111-1111-111111111111");
        let edited = base.join("22222222-2222-2222-2222-222222222222");
        let partial = base.join("33333333-3333-3333-3333-333333333333");
        let sidecar = base.join("44444444-4444-4444-4444-444444444444");
        for dir in [&unchanged, &edited, &partial, &sidecar] {
            fs::create_dir_all(dir).unwrap();
        }
        let original = b"original";
        let record = Completed {
            filename: "file.txt".into(),
            size: original.len() as u64,
            sha256: format!("{:x}", Sha256::digest(original)),
        };
        for dir in [&unchanged, &edited, &sidecar] {
            fs::write(dir.join("file.txt"), original).unwrap();
            fs::write(
                dir.join("completed.json"),
                serde_json::to_vec(&record).unwrap(),
            )
            .unwrap();
        }
        fs::write(edited.join("file.txt"), b"modified").unwrap();
        fs::write(sidecar.join("notes.txt"), b"keep this").unwrap();
        fs::write(partial.join("download.partial"), b"partial").unwrap();
        cleanup_at(
            &base,
            SystemTime::now() + RETENTION + Duration::from_secs(5),
        );
        assert!(!unchanged.exists());
        assert!(!partial.exists());
        assert_eq!(fs::read(edited.join("file.txt")).unwrap(), b"modified");
        assert_eq!(fs::read(sidecar.join("notes.txt")).unwrap(), b"keep this");
        fs::remove_dir_all(base).unwrap();
    }
}
