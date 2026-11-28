// Primitives and queue commands for local/remote copies. Completed downloads
// are published only after their remote sources have been checked again.
use super::{browse::check_path, Remotes};
use crate::domain::filesystem::staging::{rename_new, StageDirectory};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;

pub(crate) mod batch_move;
mod destination_stage;
mod move_remote;
mod move_source;
mod move_upload;
pub(crate) mod preflight;
mod remote_copy;
mod replace;
pub(super) mod tree;
mod upload;
pub(crate) use move_remote::move_entry as move_remote_entry;
pub(crate) use move_upload::move_file as move_upload_file;
pub(crate) use remote_copy::copy_transfer as copy_remote_entry;
pub(crate) use replace::{download as replace_download, upload as replace_upload};
pub(crate) use tree::{download_entry, upload_entry};
pub(crate) use upload::upload_file;

pub(crate) const RECOVERY_CANCELLED_PREFIX: &str = "Transfer cancelled; recovery required: ";

// Keep local and remote paths separate all the way through queue scheduling.
#[derive(Clone)]
pub(crate) enum Direction {
    Download {
        remote_path: String,
        local_folder: PathBuf,
    },
    Upload {
        local_path: PathBuf,
        remote_folder: String,
    },
    Remote {
        remote_path: String,
        dest_profile: String,
        dest_session: u32,
        remote_folder: String,
    },
    Rename {
        parent: String,
        destination: String,
        entries: Vec<super::operations::SelectedEntry>,
    },
}

#[derive(Clone)]
pub(crate) struct Transfer {
    pub remotes: Remotes,
    pub profile: String,
    pub session: u32,
    pub direction: Direction,
    pub replace: bool,
    pub moving: bool,
    pub recovery: Option<super::recovery::RecoveryJournal>,
    pub expected: Option<super::operations::SelectedEntry>,
    pub source_changed: Option<std::sync::Arc<dyn Fn(String) + Send + Sync>>,
}

#[derive(Clone)]
pub(crate) struct TransferBatch {
    // The queue owns virtual attachment data through waiting, conflict decisions and execution.
    _drop_stage: Option<std::sync::Arc<crate::platform::windows::dragdrop::DropStage>>,
    pub items: Vec<Transfer>,
    pub request_decision: std::sync::Arc<
        dyn Fn(Vec<usize>) -> Result<preflight::PendingDecision, String> + Send + Sync,
    >,
    pub item_finished: std::sync::Arc<dyn Fn(usize) + Send + Sync>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchItemResult {
    pub index: usize,
    pub result: Option<TransferResult>,
    pub error: Option<String>,
    pub skipped: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchResult {
    pub items: Vec<BatchItemResult>,
    pub cancelled: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchRequestItem {
    request: TransferRequest,
    expected: Option<super::operations::SelectedEntry>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteDirectoryChange {
    profile_id: String,
    session_id: u32,
    path: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransferResult {
    pub path: String,
    pub backup: Option<String>,
    pub warning: Option<String>,
    #[serde(skip)]
    pub local_path: Option<PathBuf>,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum TransferRequest {
    Download {
        #[serde(rename = "remotePath")]
        remote_path: String,
        #[serde(rename = "localFolder")]
        local_folder: PathBuf,
    },
    Upload {
        #[serde(rename = "localPath")]
        local_path: PathBuf,
        #[serde(rename = "remoteFolder")]
        remote_folder: String,
    },
    Remote {
        #[serde(rename = "remotePath")]
        remote_path: String,
        #[serde(rename = "destProfile")]
        dest_profile: String,
        #[serde(rename = "destSession")]
        dest_session: u32,
        #[serde(rename = "remoteFolder")]
        remote_folder: String,
    },
    Rename {
        parent: String,
        destination: String,
        entries: Vec<super::operations::SelectedEntry>,
    },
}

fn direction_for(request: TransferRequest) -> Result<Direction, String> {
    match request {
        TransferRequest::Download {
            remote_path,
            local_folder,
        } if local_folder.is_absolute() => {
            check_path(&remote_path, false).map_err(|error| error.message().to_owned())?;
            Ok(Direction::Download {
                remote_path,
                local_folder,
            })
        }
        TransferRequest::Upload {
            local_path,
            remote_folder,
        } if local_path.is_absolute() => {
            check_path(&remote_folder, false).map_err(|error| error.message().to_owned())?;
            Ok(Direction::Upload {
                local_path,
                remote_folder,
            })
        }
        TransferRequest::Remote {
            remote_path,
            dest_profile,
            dest_session,
            remote_folder,
        } => {
            check_path(&remote_path, false).map_err(|e| e.message().to_owned())?;
            check_path(&remote_folder, false).map_err(|e| e.message().to_owned())?;
            Ok(Direction::Remote {
                remote_path,
                dest_profile,
                dest_session,
                remote_folder,
            })
        }
        TransferRequest::Rename {
            parent,
            destination,
            entries,
        } if !entries.is_empty() && entries.len() <= 100_000 => {
            check_path(&parent, false).map_err(|e| e.message().to_owned())?;
            check_path(&destination, false).map_err(|e| e.message().to_owned())?;
            Ok(Direction::Rename {
                parent,
                destination,
                entries,
            })
        }
        _ => Err("Choose an absolute local path.".into()),
    }
}

async fn conflict_for(job: &Transfer) -> Result<bool, String> {
    let remotes = &job.remotes;
    match &job.direction {
        Direction::Download {
            remote_path,
            local_folder,
        } => {
            let target = destination(local_folder, remote_path)?;
            match fs::symlink_metadata(target) {
                Ok(_) => Ok(true),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
                Err(error) => Err(format!("Could not check the destination: {error}")),
            }
        }
        Direction::Upload {
            local_path,
            remote_folder,
        } => {
            let target = remote_destination(local_path, remote_folder)?;
            remotes.exists(&job.profile, job.session, &target).await
        }
        Direction::Remote {
            remote_path,
            dest_profile,
            dest_session,
            remote_folder,
        } => {
            let name = remote_path
                .rsplit('/')
                .next()
                .filter(|n| !n.is_empty())
                .ok_or("Invalid remote source.")?;
            let target = format!("{}/{name}", remote_folder.trim_end_matches('/'));
            check_path(&target, false).map_err(|e| e.message().to_owned())?;
            remotes.exists(dest_profile, *dest_session, &target).await
        }
        Direction::Rename { .. } => Err("Invalid conflict check.".into()),
    }
}

fn remote_destination(source: &Path, folder: &str) -> Result<String, String> {
    check_path(folder, false).map_err(|error| error.message().to_owned())?;
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or("The source name cannot be represented on the remote host.")?;
    let target = format!("{}/{name}", folder.trim_end_matches('/'));
    check_path(&target, false).map_err(|error| error.message().to_owned())?;
    Ok(target)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchItemFinished {
    transfer_id: String,
    index: usize,
}

fn staged_upload_paths(items: &[BatchRequestItem], moving: bool) -> Result<Vec<String>, String> {
    if moving {
        return Err("Temporary attachments can only be copied.".into());
    }
    items
        .iter()
        .map(|item| match &item.request {
            TransferRequest::Upload { local_path, .. } => local_path
                .to_str()
                .map(str::to_owned)
                .ok_or_else(|| "Invalid temporary attachment path.".into()),
            _ => Err("Temporary attachments can only be uploaded.".into()),
        })
        .collect()
}

// One queue job owns the whole selection, including its pause/cancel state.
#[tauri::command]
pub(crate) async fn remote_transfer_batch(
    webview: tauri::Webview,
    profile_id: String,
    session_id: u32,
    items: Vec<BatchRequestItem>,
    transfer_id: String,
    moving: bool,
    drop_stage: Option<u64>,
) -> Result<BatchResult, String> {
    if items.is_empty() || items.len() > 100_000 {
        return Err("Select between 1 and 100000 items.".into());
    }
    let remotes = super::manager(&webview)?;
    remotes.current(&profile_id, Some(session_id))?;
    let stage = drop_stage
        .map(|id| {
            let paths = staged_upload_paths(&items, moving)?;
            webview
                .state::<crate::platform::windows::dragdrop::IncomingDrops>()
                .take_for_transfer(webview.label(), id, &paths)
                .map(std::sync::Arc::new)
        })
        .transpose()?;
    let journal = super::recovery::RecoveryJournal::for_webview(&webview)?;
    let app = webview.app_handle().clone();
    let source_profile = profile_id.clone();
    let notify = std::sync::Arc::new(move |path| {
        let _ = app.emit_to(
            "main",
            "remote-directory-changed",
            RemoteDirectoryChange {
                profile_id: source_profile.clone(),
                session_id,
                path,
            },
        );
    }) as std::sync::Arc<dyn Fn(String) + Send + Sync>;
    let mut jobs = Vec::with_capacity(items.len());
    for item in items {
        let direction = direction_for(item.request)?;
        if matches!(&direction, Direction::Rename { .. }) {
            return Err("Invalid batch item.".into());
        }
        if moving && !matches!(&direction, Direction::Upload { .. }) && item.expected.is_none() {
            return Err("The remote selection is unavailable. Refresh and try again.".into());
        }
        if let Direction::Remote {
            dest_profile,
            dest_session,
            ..
        } = &direction
        {
            remotes.current(dest_profile, Some(*dest_session))?;
            if moving && dest_profile == &profile_id && *dest_session == session_id {
                return Err("Use a same-host move for this destination.".into());
            }
        }
        let needs_journal = matches!(&direction, Direction::Remote { .. })
            || (moving && matches!(&direction, Direction::Download { .. }));
        jobs.push(Transfer {
            remotes: remotes.clone(),
            profile: profile_id.clone(),
            session: session_id,
            direction,
            replace: false,
            moving,
            recovery: needs_journal.then(|| journal.clone()),
            expected: item.expected,
            source_changed: moving.then(|| notify.clone()),
        });
    }
    let indexed_search = webview
        .state::<crate::services::indexed_search::IndexedSearchHandle>()
        .inner()
        .clone();
    let queue = webview
        .state::<crate::services::transfer_manager::TransferManagerHandle>()
        .inner()
        .clone();
    let window = webview.window();
    let app = webview.app_handle().clone();
    let event_id = transfer_id.clone();
    let item_finished = std::sync::Arc::new(move |index| {
        let _ = app.emit_to(
            "main",
            "remote-transfer-batch-item",
            BatchItemFinished {
                transfer_id: event_id.clone(),
                index,
            },
        );
    });
    let decision_app = webview.app_handle().clone();
    let decision_id = transfer_id.clone();
    let request_decision = std::sync::Arc::new(move |indices| {
        preflight::request_decision(&decision_app, &decision_id, indices)
    });
    let reconcile_jobs = jobs.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        queue.remote_batch(
            window,
            TransferBatch {
                _drop_stage: stage,
                items: jobs,
                request_decision,
                item_finished,
            },
            Some(transfer_id),
        )
    })
    .await
    .map_err(|_| "Could not run the remote transfer.".to_owned())??;
    let mut changed = Vec::new();
    for item in &result.items {
        let Some(output) = &item.result else { continue };
        let Some(job) = reconcile_jobs.get(item.index) else {
            continue;
        };
        if matches!(&job.direction, Direction::Download { .. }) {
            changed.push(output.path.clone());
            if let Some(backup) = &output.backup {
                changed.push(backup.clone());
            }
        }
        if moving {
            if let Direction::Upload { local_path, .. } = &job.direction {
                changed.push(local_path.to_string_lossy().into_owned());
            }
        }
    }
    if !changed.is_empty() {
        if let Err(error) = indexed_search.queue_reconcile_paths(changed) {
            eprintln!(
                "Could not queue indexed search reconciliation after remote transfer: {error}"
            );
        }
    }
    Ok(result)
}

// Jobs use the same Work queue, pause/cancel controls, and shutdown lifecycle
// as local transfers. The frontend decides when to offer this command.
#[tauri::command]
pub(crate) async fn remote_transfer_file(
    webview: tauri::Webview,
    profile_id: String,
    session_id: u32,
    request: TransferRequest,
    transfer_id: Option<String>,
) -> Result<BatchResult, String> {
    let remotes = super::manager(&webview)?;
    remotes.current(&profile_id, Some(session_id))?;
    let direction = direction_for(request)?;
    if !matches!(&direction, Direction::Rename { .. }) {
        return Err("Invalid move request.".into());
    }
    let queue = webview
        .state::<crate::services::transfer_manager::TransferManagerHandle>()
        .inner()
        .clone();
    let window = webview.window();
    let source_changed = {
        let app = webview.app_handle().clone();
        let profile = profile_id.clone();
        Some(std::sync::Arc::new(move |path| {
            let _ = app.emit_to(
                "main",
                "remote-directory-changed",
                RemoteDirectoryChange {
                    profile_id: profile.clone(),
                    session_id,
                    path,
                },
            );
        }) as std::sync::Arc<dyn Fn(String) + Send + Sync>)
    };
    let job = Transfer {
        remotes,
        profile: profile_id,
        session: session_id,
        direction,
        replace: false,
        moving: true,
        recovery: None,
        expected: None,
        source_changed,
    };
    tauri::async_runtime::spawn_blocking(move || queue.remote_file(window, job, transfer_id))
        .await
        .map_err(|_| "Could not run the remote transfer.".to_owned())?
}

// Yield the shared SFTP connection frequently enough for browsing and previews.
const CHUNK: usize = 256 * 1024;

struct DownloadStage {
    _directory: StageDirectory,
    partial: PathBuf,
}

impl DownloadStage {
    fn beside(target: &Path) -> Result<Self, String> {
        let directory = StageDirectory::beside(target, "remote-download")
            .map_err(|error| format!("Could not create a temporary download: {error}"))?;
        let partial = directory.path.join("file.part");
        Ok(Self {
            _directory: directory,
            partial,
        })
    }

    fn cleanup(&self) -> Result<(), String> {
        match fs::remove_file(&self.partial) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!(
                "Could not remove {}: {error}",
                self.partial.display()
            )),
        }
    }
}

impl Drop for DownloadStage {
    fn drop(&mut self) {
        // The normal error path reports cleanup failures. This is a fallback
        // for a dropped future or an unexpected return.
        let _ = self.cleanup();
    }
}

fn valid_windows_name(name: &str) -> bool {
    if name.is_empty()
        || name.encode_utf16().count() > 255
        || name.ends_with([' ', '.'])
        || name.chars().any(|c| {
            c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
        })
    {
        return false;
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return false;
    }
    if let Some(number) = stem
        .strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"))
    {
        if matches!(
            number,
            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
        ) {
            return false;
        }
    }
    true
}

fn destination(folder: &Path, remote_path: &str) -> Result<PathBuf, String> {
    check_path(remote_path, false).map_err(|error| error.message().to_owned())?;
    let name = remote_path.rsplit('/').next().unwrap_or("");
    if !valid_windows_name(name) {
        return Err("This filename cannot be saved on Windows without changing it.".into());
    }
    if !folder.is_dir() {
        return Err("The destination folder is unavailable.".into());
    }
    Ok(folder.join(name))
}

// Copy a single regular file. The caller owns the connection, progress, and
// cancellation policy; no remote or existing local file is changed.
pub(crate) async fn download_file(
    remotes: &Remotes,
    profile: &str,
    session: u32,
    remote_path: &str,
    folder: &Path,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<PathBuf, String> {
    checkpoint()?;
    let target = destination(folder, remote_path)?;
    match fs::symlink_metadata(&target) {
        Ok(_) => return Err("An item with this name already exists in the destination.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Could not check the destination: {error}")),
    }
    let metadata = remotes
        .read_range(profile, session, remote_path, 0, 0)
        .await?;
    if metadata.modified.is_none() {
        return Err("The server did not provide a modification time for this file.".into());
    }
    let stage = DownloadStage::beside(&target)?;
    let result: Result<(), String> = async {
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&stage.partial)
            .map_err(|error| format!("Could not create the download: {error}"))?;
        let mut file = tokio::fs::File::from_std(file);
        let mut done = 0u64;
        progress(done, metadata.size);
        while done < metadata.size {
            checkpoint()?;
            let count = (metadata.size - done).min(CHUNK as u64) as usize;
            let part = remotes
                .read_range(profile, session, remote_path, done, count)
                .await?;
            if part.size != metadata.size
                || part.modified != metadata.modified
                || part.bytes.len() != count
            {
                return Err("The remote file changed while downloading.".into());
            }
            file.write_all(&part.bytes)
                .await
                .map_err(|error| format!("Could not write the download: {error}"))?;
            done += count as u64;
            progress(done, metadata.size);
        }
        checkpoint()?;
        let final_metadata = remotes
            .read_range(profile, session, remote_path, done, 0)
            .await?;
        if final_metadata.size != metadata.size || final_metadata.modified != metadata.modified {
            return Err("The remote file changed while downloading.".into());
        }
        file.sync_all()
            .await
            .map_err(|error| format!("Could not finish the download: {error}"))?;
        drop(file);
        checkpoint()?;
        // Windows' no-replace rename protects an item created during the copy.
        rename_new(&stage.partial, &target)
            .map_err(|error| format!("Could not publish the download: {error}"))?;
        Ok(())
    }
    .await;
    if let Err(error) = result {
        return match stage.cleanup() {
            Ok(()) => Err(error),
            Err(cleanup) => Err(format!("{error} {cleanup}")),
        };
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_batch_accepts_only_copy_uploads_and_keeps_the_files_until_workers_finish() {
        use crate::platform::windows::dragdrop::claimed_test_file;
        let (stage, source) = claimed_test_file();
        let mut items = vec![BatchRequestItem {
            request: TransferRequest::Upload {
                local_path: PathBuf::from(&source),
                remote_folder: "/inbox".into(),
            },
            expected: None,
        }];
        assert_eq!(
            staged_upload_paths(&items, false).unwrap(),
            [source.clone()]
        );
        assert!(staged_upload_paths(&items, true).is_err());
        items.push(BatchRequestItem {
            request: TransferRequest::Download {
                remote_path: "/file".into(),
                local_folder: std::env::temp_dir(),
            },
            expected: None,
        });
        assert!(staged_upload_paths(&items, false).is_err());
        let batch = TransferBatch {
            _drop_stage: Some(std::sync::Arc::new(stage)),
            items: Vec::new(),
            request_decision: std::sync::Arc::new(|_| unreachable!()),
            item_finished: std::sync::Arc::new(|_| {}),
        };
        let worker = batch.clone();
        drop(batch);
        assert_eq!(fs::read(&source).unwrap(), b"sample");
        drop(worker);
        assert!(!Path::new(&source).exists());
    }

    #[test]
    fn destination_rejects_names_that_windows_cannot_preserve() {
        let folder = std::env::temp_dir();
        assert_eq!(
            destination(&folder, "/srv/hello.txt").unwrap(),
            folder.join("hello.txt")
        );
        for name in [
            "/srv/CON.txt",
            "/srv/a:b.txt",
            "/srv/trailing.",
            "/srv/with\\slash",
        ] {
            assert!(destination(&folder, name).is_err(), "{name}");
        }
        assert!(valid_windows_name(&format!("{}.txt", "a".repeat(220))));
        assert!(!valid_windows_name("COM¹.txt"));
    }

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_TEST_RANGE"]
    fn download_is_bounded_cancelable_and_never_replaces_a_destination() {
        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let remote = std::env::var("STRATUM_SFTP_TEST_RANGE").unwrap();
            let remotes = Remotes::default();
            let connected = remotes
                .connect("download-test", &host, "", std::sync::Arc::new(|_| {}))
                .await
                .unwrap();
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let folder = std::env::temp_dir().join(format!(
                "stratum-download-test-{:032x}",
                u128::from_le_bytes(random)
            ));
            fs::create_dir(&folder).unwrap();
            let transferred = std::cell::Cell::new(0);
            let cancelled = download_file(
                &remotes,
                "download-test",
                connected.session_id,
                &remote,
                &folder,
                &mut || {
                    if transferred.get() > 0 {
                        Err("Cancelled".into())
                    } else {
                        Ok(())
                    }
                },
                &mut |done, _| transferred.set(done),
            )
            .await;
            assert_eq!(cancelled.unwrap_err(), "Cancelled");
            assert!(fs::read_dir(&folder).unwrap().next().is_none());
            assert!(remotes
                .current("download-test", Some(connected.session_id))
                .is_ok());
            let name = remote.rsplit('/').next().unwrap();
            let raced_target = folder.join(name);
            let made_conflict = std::cell::Cell::new(false);
            let conflict = download_file(
                &remotes,
                "download-test",
                connected.session_id,
                &remote,
                &folder,
                &mut || Ok(()),
                &mut |done, _| {
                    if done > 0 && !made_conflict.replace(true) {
                        fs::write(&raced_target, b"created during download").unwrap();
                    }
                },
            )
            .await;
            assert!(conflict.is_err());
            assert_eq!(fs::read(&raced_target).unwrap(), b"created during download");
            assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
            fs::remove_file(&raced_target).unwrap();
            let target = download_file(
                &remotes,
                "download-test",
                connected.session_id,
                &remote,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            let expected = remotes
                .read_range("download-test", connected.session_id, &remote, 0, 64)
                .await
                .unwrap();
            let downloaded = fs::read(&target).unwrap();
            assert_eq!(downloaded.len() as u64, expected.size);
            assert_eq!(&downloaded[..expected.bytes.len()], &expected.bytes);
            let conflict = download_file(
                &remotes,
                "download-test",
                connected.session_id,
                &remote,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap_err();
            assert!(conflict.contains("already exists"));
            assert_eq!(fs::read(&target).unwrap(), downloaded);
            remotes.disconnect("download-test").await;
            fs::remove_dir_all(folder).unwrap();
        });
    }

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_TEST_FOLDER to an empty test directory"]
    fn upload_cleans_cancelled_stages_and_refuses_to_replace_existing_files() {
        tauri::async_runtime::block_on(async {
            use super::super::wire::{Reply, Request};
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let folder = std::env::var("STRATUM_SFTP_TEST_FOLDER").unwrap();
            let remotes = Remotes::default();
            let connection = remotes
                .connect("upload-test", &host, "", std::sync::Arc::new(|_| {}))
                .await
                .unwrap();
            let (stage, source) = crate::platform::windows::dragdrop::claimed_test_file();
            let source = PathBuf::from(source);
            let data = (0..200_000)
                .map(|value| (value % 251) as u8)
                .collect::<Vec<_>>();
            fs::write(&source, &data).unwrap();
            let transferred = std::cell::Cell::new(0);
            let cancelled = upload_file(
                &remotes,
                "upload-test",
                connection.session_id,
                &source,
                &folder,
                &mut || {
                    if transferred.get() > 0 {
                        Err("Cancelled".into())
                    } else {
                        Ok(())
                    }
                },
                &mut |done, _| transferred.set(done),
            )
            .await;
            assert_eq!(cancelled.unwrap_err(), "Cancelled");
            let listing = remotes
                .list("upload-test", &folder, Some(connection.session_id))
                .await
                .unwrap();
            assert!(serde_json::to_value(listing).unwrap()["entries"]
                .as_array()
                .unwrap()
                .is_empty());
            let remote = upload_file(
                &remotes,
                "upload-test",
                connection.session_id,
                &source,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            let read = remotes
                .read_range("upload-test", connection.session_id, &remote, 0, data.len())
                .await
                .unwrap();
            assert_eq!(read.bytes, data);
            fs::write(&source, b"replacement").unwrap();
            assert!(upload_file(
                &remotes,
                "upload-test",
                connection.session_id,
                &source,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {}
            )
            .await
            .is_err());
            let read = remotes
                .read_range("upload-test", connection.session_id, &remote, 0, data.len())
                .await
                .unwrap();
            assert_eq!(read.bytes, data);
            let listing = remotes
                .list("upload-test", &folder, Some(connection.session_id))
                .await
                .unwrap();
            assert_eq!(
                serde_json::to_value(listing).unwrap()["entries"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
            let session = remotes
                .current("upload-test", Some(connection.session_id))
                .unwrap();
            let mut wire = session.wire.lock().await;
            session
                .complete(
                    async {
                        wire.path_request(Request::Remove, remote.as_bytes(), Reply::Status)
                            .await?;
                        Ok(())
                    },
                    60,
                )
                .await
                .unwrap();
            drop(wire);
            remotes.disconnect("upload-test").await;
            drop(stage);
            assert!(!source.exists());
        });
    }
}
