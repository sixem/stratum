// User-initiated SFTP mutations. Paths are kept as remote POSIX paths and
// creation/rename never intentionally replace an existing entry.
use super::{
    browse, manager,
    wire::{put_string, Attrs, Error, Fields, Reply, Request, Wire},
    Remotes, Session,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Emitter, Manager, Webview};

const MAX_DELETE_ENTRIES: usize = 10_000;
const MAX_DELETE_DEPTH: usize = 64;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectedEntry {
    pub(crate) name: String,
    pub(super) is_dir: bool,
    pub(super) is_symlink: bool,
    size: Option<u64>,
    modified: Option<u64>,
}

fn child(parent: &str, name: &str) -> Result<String, String> {
    browse::check_path(parent, false).map_err(|e| e.message().to_owned())?;
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\0']) {
        return Err("Enter a valid remote name without slashes.".into());
    }
    let path = format!("{}/{name}", parent.trim_end_matches('/'));
    browse::check_path(&path, false).map_err(|e| e.message().to_owned())?;
    Ok(path)
}

async fn checked_parent(wire: &mut Wire, parent: &str) -> super::wire::Result<()> {
    if browse::canonical(wire, parent).await? != parent {
        return Err(Error::Request(
            "The remote folder changed. Refresh and try again.".into(),
        ));
    }
    Ok(())
}

async fn lstat(wire: &mut Wire, path: &str) -> super::wire::Result<Attrs> {
    let packet = wire
        .path_request(Request::Lstat, path.as_bytes(), Reply::Attrs)
        .await?;
    Fields(&packet).attrs()
}

pub(super) fn same_entry(expected: &SelectedEntry, attrs: &Attrs) -> bool {
    let kind = if expected.is_symlink {
        0o120000
    } else if expected.is_dir {
        0o040000
    } else {
        0o100000
    };
    attrs.kind() == kind
        && expected.size.is_none_or(|size| attrs.size == Some(size))
        && expected
            .modified
            .is_none_or(|time| attrs.modified == Some(time))
}

async fn check_entry(
    wire: &mut Wire,
    path: &str,
    expected: &SelectedEntry,
) -> super::wire::Result<()> {
    if !same_entry(expected, &lstat(wire, path).await?) {
        return Err(Error::Request(
            "The remote item changed. Refresh and try again.".into(),
        ));
    }
    Ok(())
}

async fn rename(wire: &mut Wire, from: &str, to: &str) -> super::wire::Result<()> {
    let mut payload = Vec::new();
    put_string(&mut payload, from.as_bytes());
    put_string(&mut payload, to.as_bytes());
    wire.request(Request::Rename, &payload, Reply::Status)
        .await?;
    Ok(())
}

async fn mkdir(wire: &mut Wire, path: &str, private: bool) -> super::wire::Result<()> {
    let mut payload = Vec::new();
    put_string(&mut payload, path.as_bytes());
    if private {
        payload.extend_from_slice(&4u32.to_be_bytes()); // SSH_FILEXFER_ATTR_PERMISSIONS
        payload.extend_from_slice(&0o700u32.to_be_bytes());
    } else {
        payload.extend_from_slice(&0u32.to_be_bytes());
    }
    wire.request(Request::Mkdir, &payload, Reply::Status)
        .await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn remote_create_entry(
    webview: Webview,
    profile_id: String,
    session_id: u32,
    parent: String,
    name: String,
    directory: bool,
) -> Result<(), String> {
    create(
        &manager(&webview)?,
        &profile_id,
        session_id,
        &parent,
        &name,
        directory,
    )
    .await
}

async fn create(
    remotes: &Remotes,
    profile: &str,
    id: u32,
    parent: &str,
    name: &str,
    directory: bool,
) -> Result<(), String> {
    let path = child(parent, name)?;
    let session = remotes.current(profile, Some(id))?;
    let mut wire = session.wire.lock().await;
    session
        .complete(
            async {
                checked_parent(&mut wire, parent).await?;
                if directory {
                    return mkdir(&mut wire, &path, false).await;
                }
                let mut payload = Vec::new();
                put_string(&mut payload, path.as_bytes());
                // WRITE | CREAT | EXCL: never truncate or overwrite another file.
                payload.extend_from_slice(&0x2au32.to_be_bytes());
                payload.extend_from_slice(&0u32.to_be_bytes());
                let packet = wire.request(Request::Open, &payload, Reply::Handle).await?;
                let handle = Fields(&packet).string()?.to_vec();
                wire.close(&handle).await
            },
            60,
        )
        .await
}

#[tauri::command]
pub(crate) async fn remote_rename_entry(
    webview: Webview,
    profile_id: String,
    session_id: u32,
    parent: String,
    entry: SelectedEntry,
    name: String,
) -> Result<(), String> {
    rename_entry(
        &manager(&webview)?,
        &profile_id,
        session_id,
        &parent,
        &entry,
        &name,
    )
    .await
}

async fn rename_entry(
    remotes: &Remotes,
    profile: &str,
    id: u32,
    parent: &str,
    entry: &SelectedEntry,
    name: &str,
) -> Result<(), String> {
    let from = child(parent, &entry.name)?;
    let to = child(parent, name)?;
    if from == to {
        return Ok(());
    }
    let session = remotes.current(profile, Some(id))?;
    let mut wire = session.wire.lock().await;
    session
        .complete(
            async {
                checked_parent(&mut wire, parent).await?;
                check_entry(&mut wire, &from, entry).await?;
                match lstat(&mut wire, &to).await {
                    Err(Error::NotFound) => {}
                    Ok(_) => {
                        return Err(Error::Request(
                            "An item with that name already exists.".into(),
                        ))
                    }
                    Err(error) => return Err(error),
                }
                rename(&mut wire, &from, &to).await
            },
            60,
        )
        .await
}

// SFTP rename is a same-server move. Both parents must still resolve to the
// directories the user saw, and an occupied destination is never replaced.
#[tauri::command]
pub(crate) async fn remote_move_entry(
    webview: Webview,
    profile_id: String,
    session_id: u32,
    parent: String,
    destination: String,
    entry: SelectedEntry,
) -> Result<(), String> {
    move_entry(
        &manager(&webview)?,
        &profile_id,
        session_id,
        &parent,
        &destination,
        &entry,
    )
    .await
}

pub(crate) async fn move_entry(
    remotes: &Remotes,
    profile: &str,
    id: u32,
    parent: &str,
    destination: &str,
    entry: &SelectedEntry,
) -> Result<(), String> {
    let from = child(parent, &entry.name)?;
    let to = child(destination, &entry.name)?;
    if from == to {
        return Err("The item is already in this folder.".into());
    }
    if entry.is_dir && !entry.is_symlink && destination.starts_with(&format!("{from}/"))
        || destination == from
    {
        return Err("A folder cannot be moved into itself.".into());
    }
    let session = remotes.current(profile, Some(id))?;
    let mut wire = session.wire.lock().await;
    session
        .complete(
            async {
                checked_parent(&mut wire, parent).await?;
                checked_parent(&mut wire, destination).await?;
                check_entry(&mut wire, &from, entry).await?;
                match lstat(&mut wire, &to).await {
                    Err(Error::NotFound) => {}
                    Ok(_) => {
                        return Err(Error::Request(
                            "An item with that name already exists in the destination.".into(),
                        ))
                    }
                    Err(error) => return Err(error),
                }
                rename(&mut wire, &from, &to).await
            },
            60,
        )
        .await
}

async fn remove(session: &Arc<Session>, path: &str, directory: bool) -> Result<(), String> {
    let mut wire = session.wire.lock().await;
    session
        .complete(
            async {
                wire.path_request(
                    if directory {
                        Request::Rmdir
                    } else {
                        Request::Remove
                    },
                    path.as_bytes(),
                    Reply::Status,
                )
                .await?;
                Ok(())
            },
            60,
        )
        .await
}

// Restore a journalled stage only when its paths and current entries still match.
pub(super) async fn recover_delete_stage(
    remotes: &Remotes,
    profile: &str,
    id: u32,
    record: &super::delete_recovery::DeleteStage,
) -> Result<bool, String> {
    if record.id.len() != 32 || !record.id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid delete recovery ID.".into());
    }
    let (parent, _) = record
        .original
        .rsplit_once('/')
        .ok_or("Invalid original path.")?;
    let parent = if parent.is_empty() { "/" } else { parent };
    if child(parent, &record.selected.name)? != record.original
        || child(parent, &format!(".stratum-delete-{}", record.id))? != record.stage
    {
        return Err("Invalid delete recovery paths.".into());
    }
    let staged = child(&record.stage, "item")?;
    let session = remotes.current(profile, Some(id))?;
    let mut wire = session.wire.lock().await;
    session
        .complete(
            async {
                checked_parent(&mut wire, parent).await?;
                let original = match lstat(&mut wire, &record.original).await {
                    Ok(attrs) => Some(attrs),
                    Err(Error::NotFound) => None,
                    Err(error) => return Err(error),
                };
                let stage = match lstat(&mut wire, &record.stage).await {
                    Ok(attrs) => Some(attrs),
                    Err(Error::NotFound) => None,
                    Err(error) => return Err(error),
                };
                let Some(stage) = stage else {
                    return if original
                        .as_ref()
                        .is_some_and(|attrs| record.deleting || same_entry(&record.selected, attrs))
                    {
                        Ok(false)
                    } else {
                        Err(Error::Request(
                            "Neither the expected original nor its staged item was found.".into(),
                        ))
                    };
                };
                if stage.kind() != 0o040000 {
                    return Err(Error::Request("The staging folder changed.".into()));
                }
                checked_parent(&mut wire, &record.stage).await?;
                let item = match lstat(&mut wire, &staged).await {
                    Ok(attrs) => Some(attrs),
                    Err(Error::NotFound) => None,
                    Err(error) => return Err(error),
                };
                match (original, item) {
                    (Some(attrs), None)
                        if record.deleting || same_entry(&record.selected, &attrs) =>
                    {
                        wire.path_request(Request::Rmdir, record.stage.as_bytes(), Reply::Status)
                            .await?;
                        Ok(false)
                    }
                    (None, Some(attrs)) => {
                        let expected_kind = if record.selected.is_symlink {
                            0o120000
                        } else if record.selected.is_dir {
                            0o040000
                        } else {
                            0o100000
                        };
                        if attrs.kind() != expected_kind
                            || (!record.deleting && !same_entry(&record.selected, &attrs))
                        {
                            return Err(Error::Request("The staged item changed.".into()));
                        }
                        rename(&mut wire, &staged, &record.original).await?;
                        wire.path_request(Request::Rmdir, record.stage.as_bytes(), Reply::Status)
                            .await?;
                        Ok(true)
                    }
                    (Some(_), Some(_)) => Err(Error::Request(
                        "The original name is occupied; the staged item was kept.".into(),
                    )),
                    _ => Err(Error::Request(
                        "The original or staged item could not be verified.".into(),
                    )),
                }
            },
            60,
        )
        .await
}

// Remove only the staged tree the user chose. Recheck each parent and entry
// before mutation; never traverse links or unrepresentable names.
pub(super) async fn purge_staged(
    remotes: &Remotes,
    profile: &str,
    id: u32,
    root: &str,
) -> Result<(), String> {
    let session = remotes.current(profile, Some(id))?;
    let attrs = remotes.stat(profile, id, root).await?;
    if !matches!(attrs.kind(), 0o100000 | 0o040000) {
        return Err("The staged item changed or is a link; it was kept.".into());
    }
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut pending = if attrs.kind() == 0o040000 {
        vec![(root.to_owned(), 0usize)]
    } else {
        files.push(root.to_owned());
        Vec::new()
    };
    while let Some((path, depth)) = pending.pop() {
        if depth > MAX_DELETE_DEPTH {
            return Err("Folder nesting exceeds the delete limit.".into());
        }
        let attrs = remotes.stat(profile, id, &path).await?;
        if attrs.kind() != 0o040000 {
            return Err("A staged folder changed; remaining data was kept.".into());
        }
        let listing = remotes.list(profile, &path, Some(id)).await?;
        if listing.path != path || listing.omitted_entries != 0 {
            return Err("A staged folder changed or has names that cannot be displayed.".into());
        }
        directories.push(path);
        for item in listing.entries {
            if files.len() + directories.len() + pending.len() >= 100_001 {
                return Err("The staged folder contains too many items.".into());
            }
            if item.is_dir && !item.is_symlink {
                pending.push((item.path, depth + 1));
            } else {
                files.push(item.path);
            }
        }
    }
    for (path, directory) in files
        .into_iter()
        .map(|p| (p, false))
        .chain(directories.into_iter().rev().map(|p| (p, true)))
    {
        let parent = path
            .rsplit_once('/')
            .map(|(p, _)| if p.is_empty() { "/" } else { p })
            .ok_or("Invalid staged path.")?;
        let mut wire = session.wire.lock().await;
        session
            .complete(
                async {
                    checked_parent(&mut wire, parent).await?;
                    let attrs = lstat(&mut wire, &path).await?;
                    if (attrs.kind() == 0o040000) != directory {
                        return Err(Error::Request(
                            "A staged item changed; remaining data was kept.".into(),
                        ));
                    }
                    wire.path_request(
                        if directory {
                            Request::Rmdir
                        } else {
                            Request::Remove
                        },
                        path.as_bytes(),
                        Reply::Status,
                    )
                    .await?;
                    Ok(())
                },
                60,
            )
            .await
            .map_err(|error| format!("{error} Remaining data may be at {root}."))?;
    }
    Ok(())
}

#[derive(Clone)]
pub(crate) struct RemoteDelete {
    pub remotes: Remotes,
    pub profile: String,
    pub session: u32,
    pub parent: String,
    pub entries: Vec<SelectedEntry>,
    pub journal: super::recovery::RecoveryJournal,
    pub source_changed: Arc<dyn Fn(String) + Send + Sync>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteDirectoryChange {
    profile_id: String,
    session_id: u32,
    path: String,
}

// The transfer manager owns admission, cancellation and shutdown for the entire selection.
#[tauri::command]
pub(crate) async fn remote_delete_entries(
    webview: Webview,
    profile_id: String,
    session_id: u32,
    parent: String,
    entries: Vec<SelectedEntry>,
    transfer_id: Option<String>,
) -> Result<crate::domain::filesystem::DeleteReport, String> {
    if entries.is_empty() || entries.len() > 100_000 {
        return Err("Select between 1 and 100000 items.".into());
    }
    browse::check_path(&parent, false).map_err(|e| e.message().to_owned())?;
    for entry in &entries {
        child(&parent, &entry.name)?;
    }
    let remotes = manager(&webview)?;
    remotes.current(&profile_id, Some(session_id))?;
    let journal = super::recovery::RecoveryJournal::for_webview(&webview)?;
    let queue = webview
        .state::<crate::services::transfer_manager::TransferManagerHandle>()
        .inner()
        .clone();
    let window = webview.window();
    let app = webview.app_handle().clone();
    let notify_profile = profile_id.clone();
    let source_changed = Arc::new(move |path| {
        let _ = app.emit_to(
            "main",
            "remote-directory-changed",
            RemoteDirectoryChange {
                profile_id: notify_profile.clone(),
                session_id,
                path,
            },
        );
    });
    let job = RemoteDelete {
        remotes,
        profile: profile_id,
        session: session_id,
        parent,
        entries,
        journal,
        source_changed,
    };
    tauri::async_runtime::spawn_blocking(move || queue.remote_delete(window, job, transfer_id))
        .await
        .map_err(|_| "Could not run the remote deletion.".to_string())?
}

// Stage the selected item in a private folder before walking it. Never follow
// symlinks; an interrupted or rejected walk retains the remaining staged data.
pub(crate) async fn delete_managed(
    remotes: &Remotes,
    profile: &str,
    id: u32,
    parent: &str,
    entry: &SelectedEntry,
    journal: &super::recovery::RecoveryJournal,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
) -> Result<(), String> {
    checkpoint()?;
    let original = child(parent, &entry.name)?;
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Could not prepare deletion.")?;
    let stage_id = random
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let _active = super::recovery::ActiveMove::start(&stage_id)?;
    let stage_name = format!(".stratum-delete-{stage_id}");
    let stage = child(parent, &stage_name)?;
    let staged = child(&stage, "item")?;
    let session = remotes.current(profile, Some(id))?;
    let mut record = super::delete_recovery::DeleteStage {
        id: stage_id,
        host: session.host.clone(),
        original: original.clone(),
        stage: stage.clone(),
        selected: entry.clone(),
        deleting: false,
        restored_partial: false,
    };
    journal.insert_delete(&record)?;
    let result = async {
        checkpoint().map_err(|error| (error, false))?;
        {
            let mut wire = session.wire.lock().await;
            session
                .complete(
                    async {
                        checked_parent(&mut wire, parent).await?;
                        check_entry(&mut wire, &original, entry).await?;
                        mkdir(&mut wire, &stage, true).await?;
                        Ok(())
                    },
                    60,
                )
                .await
                .map_err(|error| (error, false))?;
        }
        let moved = {
            let mut wire = session.wire.lock().await;
            session
                .complete(
                    async {
                        checked_parent(&mut wire, parent).await?;
                        check_entry(&mut wire, &original, entry).await?;
                        rename(&mut wire, &original, &staged).await
                    },
                    60,
                )
                .await
        };
        moved.map_err(|error| (error, false))?;
        checkpoint().map_err(|error| (error, false))?;
        let mut deleting = false;
        let result = async {
            if !entry.is_dir || entry.is_symlink {
                journal.mark_delete_started(&record.id)?;
                record.deleting = true;
                checkpoint()?;
                deleting = true;
                return remove(&session, &staged, false).await;
            }
            let mut pending = vec![(staged.clone(), 0usize)];
            let mut files = Vec::new();
            let mut directories = Vec::new();
            while let Some((path, depth)) = pending.pop() {
                checkpoint()?;
                if depth > MAX_DELETE_DEPTH {
                    return Err("Folder nesting exceeds the delete limit.".into());
                }
                let attrs = remotes.stat(profile, id, &path).await?;
                if attrs.kind() != 0o040000 {
                    return Err("A folder changed during deletion.".into());
                }
                let listing = remotes.list(profile, &path, Some(id)).await?;
                if listing.path != path || listing.omitted_entries != 0 {
                    return Err(
                        "A folder changed or contains names that cannot be displayed.".into(),
                    );
                }
                directories.push(path);
                for item in listing.entries {
                    if files.len() + pending.len() + directories.len() >= MAX_DELETE_ENTRIES {
                        return Err("The folder contains too many items to delete at once.".into());
                    }
                    if item.is_dir && !item.is_symlink {
                        pending.push((item.path, depth + 1));
                    } else {
                        files.push(item.path);
                    }
                }
            }
            journal.mark_delete_started(&record.id)?;
            record.deleting = true;
            for path in files {
                checkpoint()?;
                deleting = true;
                remove(&session, &path, false).await?;
            }
            for path in directories.into_iter().rev() {
                checkpoint()?;
                deleting = true;
                remove(&session, &path, true).await?;
            }
            Ok(())
        }
        .await;
        if let Err(error) = result {
            return Err((error, deleting));
        }
        remove(&session, &stage, true).await.map_err(|error| {
            (
                format!("Deleted the item, but could not remove {stage}: {error}"),
                true,
            )
        })?;
        Ok::<(), (String, bool)>(())
    }
    .await;
    match result {
        Ok(()) => journal.remove_delete(&record.id),
        Err((error, deleting)) => {
            match recover_delete_stage(remotes, profile, id, &record).await {
                Ok(restored) => {
                    if deleting { journal.mark_delete_restored_partial(&record.id)?; }
                    else { journal.remove_delete(&record.id)?; }
                    if error == crate::domain::filesystem::transfer::TRANSFER_CANCELLED_MESSAGE && !deleting {
                        return Err(error);
                    }
                    Err(format!("{error} {}", if restored && deleting {
                        "Remaining contents were restored, but some may already have been deleted."
                    } else if restored { "The item was restored." } else { "Check the original location." }))
                }
                Err(recovery) => Err(format!("{error} Recovery is needed for {original}; check {staged} or reconnect: {recovery}")),
            }
        }
    }
}

#[cfg(test)]
async fn delete(
    remotes: &Remotes,
    profile: &str,
    id: u32,
    parent: &str,
    entry: &SelectedEntry,
) -> Result<(), String> {
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|e| e.to_string())?;
    let path = std::env::temp_dir().join(format!(
        "stratum-delete-test-{:032x}.sqlite",
        u128::from_le_bytes(random)
    ));
    let journal = super::recovery::RecoveryJournal::for_test(path.clone());
    let result = delete_managed(
        remotes,
        profile,
        id,
        parent,
        entry,
        &journal,
        &mut || Ok(()),
    )
    .await;
    let _ = std::fs::remove_file(path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_names_preserve_spaces_and_reject_path_traversal() {
        assert_eq!(child("/srv", " a ").unwrap(), "/srv/ a ");
        assert_eq!(child("/", "a\\b").unwrap(), "/a\\b");
        for name in ["", ".", "..", "a/b", "bad\0name"] {
            assert!(child("/srv", name).is_err());
        }
    }

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_OPERATIONS_DIR to a disposable fixture"]
    fn managed_delete_recovers_interrupted_stages_and_blocks_shutdown() {
        use crate::services::transfer_manager::{TransferManagerHandle, TransferShutdownMode};
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Mutex,
        };
        use std::time::Duration;

        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let base = std::env::var("STRATUM_SFTP_OPERATIONS_DIR").unwrap();
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let fixture_name = format!("stratum-delete-test-{:032x}", u128::from_le_bytes(random));
            let remotes = Remotes::default();
            let session = remotes
                .connect("delete-fixture", &host, &base, Arc::new(|_| {}))
                .await
                .unwrap();
            let id = session.session_id;
            create(&remotes, "delete-fixture", id, &base, &fixture_name, true)
                .await
                .unwrap();
            let parent = child(&base, &fixture_name).unwrap();
            let journal_path = std::env::temp_dir().join(format!("{fixture_name}.sqlite"));
            let journal = super::super::recovery::RecoveryJournal::for_test(journal_path.clone());
            let select = |item: &browse::Entry| SelectedEntry {
                name: item.name.clone(),
                is_dir: item.is_dir,
                is_symlink: item.is_symlink,
                size: item.size,
                modified: item.modified,
            };

            // Recreate crash windows before and after a child was removed.
            for (name, deleting, stage_id) in [
                ("untouched", false, "11111111111111111111111111111111"),
                ("partial", true, "22222222222222222222222222222222"),
            ] {
                create(&remotes, "delete-fixture", id, &parent, name, true)
                    .await
                    .unwrap();
                let original = child(&parent, name).unwrap();
                for file in ["first", "second"] {
                    create(&remotes, "delete-fixture", id, &original, file, false)
                        .await
                        .unwrap();
                }
                let listing = remotes
                    .list("delete-fixture", &parent, Some(id))
                    .await
                    .unwrap();
                let selected = select(
                    listing
                        .entries
                        .iter()
                        .find(|item| item.name == name)
                        .unwrap(),
                );
                let stage = child(&parent, &format!(".stratum-delete-{stage_id}")).unwrap();
                let record = super::super::delete_recovery::DeleteStage {
                    id: stage_id.into(),
                    host: host.clone(),
                    original: original.clone(),
                    stage: stage.clone(),
                    selected,
                    deleting: false,
                    restored_partial: false,
                };
                journal.insert_delete(&record).unwrap();
                let current = remotes.current("delete-fixture", Some(id)).unwrap();
                {
                    let mut wire = current.wire.lock().await;
                    mkdir(&mut wire, &stage, true)
                        .await
                        .map_err(|e| e.message().to_owned())
                        .unwrap();
                    rename(&mut wire, &original, &child(&stage, "item").unwrap())
                        .await
                        .map_err(|e| e.message().to_owned())
                        .unwrap();
                }
                if deleting {
                    journal.mark_delete_started(stage_id).unwrap();
                    remove(&current, &format!("{stage}/item/first"), false)
                        .await
                        .unwrap();
                }
                let mut restored = Vec::new();
                let mut warnings = Vec::new();
                let mut notices = Vec::new();
                super::super::delete_recovery::recover_interrupted_deletes(
                    &remotes,
                    &journal,
                    &host,
                    "delete-fixture",
                    id,
                    &mut restored,
                    &mut warnings,
                    &mut notices,
                )
                .await
                .unwrap();
                assert_eq!(restored, vec![original.clone()]);
                assert_eq!(!warnings.is_empty(), deleting);
                assert_eq!(notices.len(), usize::from(deleting));
                journal.acknowledge_delete_notices(&host, &notices).unwrap();
                let remaining = remotes
                    .list("delete-fixture", &original, Some(id))
                    .await
                    .unwrap();
                assert_eq!(remaining.entries.len(), if deleting { 1 } else { 2 });
            }

            // Cancellation during a recursive delete restores surviving children
            // and tells the caller that the result can be incomplete.
            create(&remotes, "delete-fixture", id, &parent, "cancelled", true)
                .await
                .unwrap();
            let cancelled = child(&parent, "cancelled").unwrap();
            for file in ["first", "second"] {
                create(&remotes, "delete-fixture", id, &cancelled, file, false)
                    .await
                    .unwrap();
            }
            let listing = remotes
                .list("delete-fixture", &parent, Some(id))
                .await
                .unwrap();
            let entry = select(
                listing
                    .entries
                    .iter()
                    .find(|item| item.name == "cancelled")
                    .unwrap(),
            );
            let mut checkpoints = 0;
            let error = delete_managed(
                &remotes,
                "delete-fixture",
                id,
                &parent,
                &entry,
                &journal,
                &mut || {
                    checkpoints += 1;
                    if checkpoints == 6 {
                        Err("Transfer cancelled".into())
                    } else {
                        Ok(())
                    }
                },
            )
            .await
            .unwrap_err();
            assert!(error.starts_with("Transfer cancelled"));
            assert!(error.contains("some may already have been deleted"));
            assert_eq!(
                remotes
                    .list("delete-fixture", &cancelled, Some(id))
                    .await
                    .unwrap()
                    .entries
                    .len(),
                1
            );
            let (mut restored, mut warnings, mut notices) = (Vec::new(), Vec::new(), Vec::new());
            super::super::delete_recovery::recover_interrupted_deletes(
                &remotes,
                &journal,
                &host,
                "delete-fixture",
                id,
                &mut restored,
                &mut warnings,
                &mut notices,
            )
            .await
            .unwrap();
            assert!(restored.is_empty());
            assert_eq!(warnings.len(), 1);
            assert_eq!(notices.len(), 1);
            journal
                .acknowledge_delete_notices("other-host", &notices)
                .unwrap();
            warnings.clear();
            notices.clear();
            super::super::delete_recovery::recover_interrupted_deletes(
                &remotes,
                &journal,
                &host,
                "delete-fixture",
                id,
                &mut restored,
                &mut warnings,
                &mut notices,
            )
            .await
            .unwrap();
            assert_eq!(warnings.len(), 1);
            journal.acknowledge_delete_notices(&host, &notices).unwrap();

            // An occupied original name is never overwritten during recovery.
            create(&remotes, "delete-fixture", id, &parent, "occupied", false)
                .await
                .unwrap();
            let original = child(&parent, "occupied").unwrap();
            let listing = remotes
                .list("delete-fixture", &parent, Some(id))
                .await
                .unwrap();
            let selected = select(
                listing
                    .entries
                    .iter()
                    .find(|item| item.name == "occupied")
                    .unwrap(),
            );
            let stage_id = "33333333333333333333333333333333";
            let stage = child(&parent, &format!(".stratum-delete-{stage_id}")).unwrap();
            let record = super::super::delete_recovery::DeleteStage {
                id: stage_id.into(),
                host: host.clone(),
                original: original.clone(),
                stage: stage.clone(),
                selected,
                deleting: false,
                restored_partial: false,
            };
            journal.insert_delete(&record).unwrap();
            let current = remotes.current("delete-fixture", Some(id)).unwrap();
            {
                let mut wire = current.wire.lock().await;
                mkdir(&mut wire, &stage, true)
                    .await
                    .map_err(|e| e.message().to_owned())
                    .unwrap();
                rename(&mut wire, &original, &child(&stage, "item").unwrap())
                    .await
                    .map_err(|e| e.message().to_owned())
                    .unwrap();
            }
            create(&remotes, "delete-fixture", id, &parent, "occupied", false)
                .await
                .unwrap();
            let (mut restored, mut warnings, mut notices) = (Vec::new(), Vec::new(), Vec::new());
            super::super::delete_recovery::recover_interrupted_deletes(
                &remotes,
                &journal,
                &host,
                "delete-fixture",
                id,
                &mut restored,
                &mut warnings,
                &mut notices,
            )
            .await
            .unwrap();
            assert!(restored.is_empty());
            assert_eq!(warnings.len(), 1);
            assert!(remotes
                .exists("delete-fixture", id, &child(&stage, "item").unwrap())
                .await
                .unwrap());
            remove(&current, &original, false).await.unwrap();
            warnings.clear();
            super::super::delete_recovery::recover_interrupted_deletes(
                &remotes,
                &journal,
                &host,
                "delete-fixture",
                id,
                &mut restored,
                &mut warnings,
                &mut notices,
            )
            .await
            .unwrap();
            assert_eq!(restored, vec![original]);
            assert!(warnings.is_empty());

            // Pause the worker after one deletion, then cancel it through the
            // same shutdown gate used by window close and updater handoff.
            for name in ["queue-first", "queue-second"] {
                create(&remotes, "delete-fixture", id, &parent, name, false)
                    .await
                    .unwrap();
            }
            let listing = remotes
                .list("delete-fixture", &parent, Some(id))
                .await
                .unwrap();
            let entries = ["queue-first", "queue-second"]
                .iter()
                .map(|name| {
                    select(
                        listing
                            .entries
                            .iter()
                            .find(|item| item.name == *name)
                            .unwrap(),
                    )
                })
                .collect();
            let (reached_tx, reached_rx) = mpsc::channel();
            let (resume_tx, resume_rx) = mpsc::channel();
            let resume_rx = Mutex::new(resume_rx);
            let first = AtomicBool::new(true);
            let job = RemoteDelete {
                remotes: remotes.clone(),
                profile: "delete-fixture".into(),
                session: id,
                parent: parent.clone(),
                entries,
                journal: journal.clone(),
                source_changed: Arc::new(move |_| {
                    if first.swap(false, Ordering::SeqCst) {
                        reached_tx.send(()).unwrap();
                        resume_rx
                            .lock()
                            .unwrap()
                            .recv_timeout(Duration::from_secs(10))
                            .unwrap();
                    }
                }),
            };
            let manager = TransferManagerHandle::init();
            let completion = manager.remote_delete_fixture(job);
            reached_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            assert!(manager
                .begin_shutdown(TransferShutdownMode::IdleOnly)
                .unwrap()
                .is_none());
            let ticket = manager
                .begin_shutdown(TransferShutdownMode::Cancel)
                .unwrap()
                .unwrap();
            resume_tx.send(()).unwrap();
            assert!(manager.wait_for_shutdown(ticket).unwrap());
            let report = completion
                .recv_timeout(Duration::from_secs(10))
                .unwrap()
                .unwrap();
            assert!(report.cancelled);
            assert_eq!(report.deleted, 1);
            assert!(remotes
                .exists(
                    "delete-fixture",
                    id,
                    &child(&parent, "queue-second").unwrap()
                )
                .await
                .unwrap());
            assert!(manager.reopen_queue(ticket).unwrap());

            let listing = remotes
                .list("delete-fixture", &base, Some(id))
                .await
                .unwrap();
            let fixture = select(
                listing
                    .entries
                    .iter()
                    .find(|item| item.name == fixture_name)
                    .unwrap(),
            );
            delete_managed(
                &remotes,
                "delete-fixture",
                id,
                &base,
                &fixture,
                &journal,
                &mut || Ok(()),
            )
            .await
            .unwrap();
            remotes.disconnect("delete-fixture").await;
            std::fs::remove_file(journal_path).unwrap();
        });
    }

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_OPERATIONS_DIR to a disposable fixture"]
    fn live_mutations_do_not_replace_or_follow_links() {
        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let parent = std::env::var("STRATUM_SFTP_OPERATIONS_DIR").unwrap();
            let remotes = Remotes::default();
            let connection = remotes
                .connect("operations", &host, &parent, Arc::new(|_| {}))
                .await
                .unwrap();
            let id = connection.session_id;
            let selected = |item: &browse::Entry| SelectedEntry {
                name: item.name.clone(),
                is_dir: item.is_dir,
                is_symlink: item.is_symlink,
                size: item.size,
                modified: item.modified,
            };
            create(&remotes, "operations", id, &parent, " file .txt", false)
                .await
                .unwrap();
            assert!(
                create(&remotes, "operations", id, &parent, " file .txt", false)
                    .await
                    .is_err()
            );
            create(&remotes, "operations", id, &parent, "other.txt", false)
                .await
                .unwrap();
            let listing = remotes.list("operations", &parent, Some(id)).await.unwrap();
            let file = selected(
                listing
                    .entries
                    .iter()
                    .find(|entry| entry.name == " file .txt")
                    .unwrap(),
            );
            create(&remotes, "operations", id, &parent, "destination", true)
                .await
                .unwrap();
            let destination = format!("{parent}/destination");
            create(
                &remotes,
                "operations",
                id,
                &destination,
                " file .txt",
                false,
            )
            .await
            .unwrap();
            assert!(
                move_entry(&remotes, "operations", id, &parent, &destination, &file)
                    .await
                    .is_err()
            );
            assert!(remotes
                .exists("operations", id, &format!("{parent}/ file .txt"))
                .await
                .unwrap());
            let occupied = remotes
                .list("operations", &destination, Some(id))
                .await
                .unwrap();
            let existing = selected(
                occupied
                    .entries
                    .iter()
                    .find(|item| item.name == " file .txt")
                    .unwrap(),
            );
            delete(&remotes, "operations", id, &destination, &existing)
                .await
                .unwrap();
            move_entry(&remotes, "operations", id, &parent, &destination, &file)
                .await
                .unwrap();
            let moved = remotes
                .list("operations", &destination, Some(id))
                .await
                .unwrap();
            let moved = selected(
                moved
                    .entries
                    .iter()
                    .find(|item| item.name == " file .txt")
                    .unwrap(),
            );
            move_entry(&remotes, "operations", id, &destination, &parent, &moved)
                .await
                .unwrap();
            create(&remotes, "operations", id, &parent, "move-folder", true)
                .await
                .unwrap();
            let folder_path = format!("{parent}/move-folder");
            create(&remotes, "operations", id, &folder_path, "child.txt", false)
                .await
                .unwrap();
            let listing = remotes.list("operations", &parent, Some(id)).await.unwrap();
            let folder = selected(
                listing
                    .entries
                    .iter()
                    .find(|item| item.name == "move-folder")
                    .unwrap(),
            );
            assert!(
                move_entry(&remotes, "operations", id, &parent, &folder_path, &folder)
                    .await
                    .is_err()
            );
            move_entry(&remotes, "operations", id, &parent, &destination, &folder)
                .await
                .unwrap();
            assert!(remotes
                .exists(
                    "operations",
                    id,
                    &format!("{destination}/move-folder/child.txt")
                )
                .await
                .unwrap());
            let mut stale = file.clone();
            stale.size = Some(file.size.unwrap_or(0) + 1);
            assert!(delete(&remotes, "operations", id, &parent, &stale)
                .await
                .is_err());
            assert!(remotes
                .exists("operations", id, &format!("{parent}/ file .txt"))
                .await
                .unwrap());
            assert!(
                rename_entry(&remotes, "operations", id, &parent, &file, "other.txt")
                    .await
                    .is_err()
            );
            rename_entry(&remotes, "operations", id, &parent, &file, "renamed.txt")
                .await
                .unwrap();
            let listing = remotes.list("operations", &parent, Some(id)).await.unwrap();
            let file = selected(
                listing
                    .entries
                    .iter()
                    .find(|entry| entry.name == "renamed.txt")
                    .unwrap(),
            );
            delete(&remotes, "operations", id, &parent, &file)
                .await
                .unwrap();
            create(&remotes, "operations", id, &parent, "empty", true)
                .await
                .unwrap();
            let listing = remotes.list("operations", &parent, Some(id)).await.unwrap();
            for name in ["empty", "tree"] {
                let item = selected(
                    listing
                        .entries
                        .iter()
                        .find(|entry| entry.name == name)
                        .unwrap(),
                );
                delete(&remotes, "operations", id, &parent, &item)
                    .await
                    .unwrap();
            }
            let unsafe_entry = selected(
                listing
                    .entries
                    .iter()
                    .find(|entry| entry.name == "unsafe")
                    .unwrap(),
            );
            assert!(delete(&remotes, "operations", id, &parent, &unsafe_entry)
                .await
                .is_err());
            assert!(remotes
                .exists("operations", id, &format!("{parent}/unsafe"))
                .await
                .unwrap());
            assert!(remotes
                .exists("operations", id, &format!("{parent}/outside/sentinel.txt"))
                .await
                .unwrap());
            let final_listing = remotes.list("operations", &parent, Some(id)).await.unwrap();
            assert!(!final_listing
                .entries
                .iter()
                .any(|item| item.name.starts_with(".stratum-delete-") || item.name == "tree"));
            remotes.disconnect("operations").await;
        });
    }
}
