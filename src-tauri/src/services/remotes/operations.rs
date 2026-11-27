// User-initiated SFTP mutations. Paths are kept as remote POSIX paths and
// creation/rename never intentionally replace an existing entry.
use super::{
    browse, manager,
    wire::{put_string, Attrs, Error, Fields, Reply, Request, Wire},
    Remotes, Session,
};
use serde::Deserialize;
use std::sync::Arc;
use tauri::Webview;

const MAX_DELETE_ENTRIES: usize = 10_000;
const MAX_DELETE_DEPTH: usize = 64;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectedEntry {
    pub(crate) name: String,
    is_dir: bool,
    is_symlink: bool,
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

#[tauri::command]
pub(crate) async fn remote_delete_entry(
    webview: Webview,
    profile_id: String,
    session_id: u32,
    parent: String,
    entry: SelectedEntry,
) -> Result<(), String> {
    delete(
        &manager(&webview)?,
        &profile_id,
        session_id,
        &parent,
        &entry,
    )
    .await
}

// Stage the selected item in a private folder before walking it. Never follow
// symlinks; an interrupted or rejected walk retains the remaining staged data.
async fn delete(
    remotes: &Remotes,
    profile: &str,
    id: u32,
    parent: &str,
    entry: &SelectedEntry,
) -> Result<(), String> {
    let original = child(parent, &entry.name)?;
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Could not prepare deletion.")?;
    let stage_name = format!(
        ".stratum-delete-{}",
        random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let stage = child(parent, &stage_name)?;
    let staged = child(&stage, "item")?;
    let session = remotes.current(profile, Some(id))?;
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
            .await?;
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
    if let Err(error) = moved {
        let _ = remove(&session, &stage, true).await;
        return Err(error);
    }
    let mut deleting = false;
    let result = async {
        if !entry.is_dir || entry.is_symlink {
            return remove(&session, &staged, false).await;
        }
        let mut pending = vec![(staged.clone(), 0usize)];
        let mut files = Vec::new();
        let mut directories = Vec::new();
        while let Some((path, depth)) = pending.pop() {
            if depth > MAX_DELETE_DEPTH {
                return Err("Folder nesting exceeds the delete limit.".into());
            }
            let attrs = remotes.stat(profile, id, &path).await?;
            if attrs.kind() != 0o040000 {
                return Err("A folder changed during deletion.".into());
            }
            let listing = remotes.list(profile, &path, Some(id)).await?;
            if listing.path != path || listing.omitted_entries != 0 {
                return Err("A folder changed or contains names that cannot be displayed.".into());
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
        for path in files {
            remove(&session, &path, false).await?;
            deleting = true;
        }
        for path in directories.into_iter().rev() {
            remove(&session, &path, true).await?;
            deleting = true;
        }
        Ok(())
    }
    .await;
    if let Err(error) = result {
        if !deleting {
            let restored = {
                let mut wire = session.wire.lock().await;
                session
                    .complete(
                        async {
                            checked_parent(&mut wire, parent).await?;
                            match lstat(&mut wire, &original).await {
                                Err(Error::NotFound) => rename(&mut wire, &staged, &original).await,
                                Ok(_) => {
                                    Err(Error::Request("The original name is now occupied.".into()))
                                }
                                Err(error) => Err(error),
                            }
                        },
                        60,
                    )
                    .await
            };
            if restored.is_ok() {
                if let Err(cleanup) = remove(&session, &stage, true).await {
                    return Err(format!("{error} The item was restored, but {stage} could not be removed: {cleanup}"));
                }
                return Err(format!("{error} The item was restored."));
            }
        }
        return Err(format!("{error} Remaining data is at {staged}."));
    }
    remove(&session, &stage, true)
        .await
        .map_err(|error| format!("Deleted the item, but could not remove {stage}: {error}"))
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
