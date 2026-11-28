// Copy a folder into a private staging folder before publishing the root.
// Links and special files are rejected rather than followed or silently skipped.
use super::super::{
    browse::check_path,
    wire::{put_string, Reply, Request},
    Session,
};
use super::EntryKind;
use super::{destination, download_file, upload_file, valid_windows_name, Remotes};
use crate::domain::filesystem::staging::{rename_new, StageDirectory};
use crate::domain::filesystem::transfer::{CopiedMoveSources, PinnedMoveSource};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

const MAX_DEPTH: usize = 64;
const MAX_ENTRIES: usize = 100_000;

type Checkpoint<'a> = &'a mut dyn FnMut() -> Result<(), String>;
type Progress<'a> = &'a mut dyn FnMut(u64, u64);

pub(crate) async fn download_entry(
    remotes: &Remotes,
    profile: &str,
    session: u32,
    path: &str,
    folder: &Path,
    checkpoint: Checkpoint<'_>,
    progress: Progress<'_>,
) -> Result<(PathBuf, EntryKind), String> {
    checkpoint()?;
    match remotes.stat(profile, session, path).await?.kind() {
        0o100000 => download_file(
            remotes, profile, session, path, folder, checkpoint, progress,
        )
        .await
        .map(|path| (path, EntryKind::File)),
        0o040000 => download_tree(
            remotes, profile, session, path, folder, checkpoint, progress,
        )
        .await
        .map(|path| (path, EntryKind::Directory)),
        _ => Err("Links and special files cannot be copied.".into()),
    }
}

async fn download_tree(
    remotes: &Remotes,
    profile: &str,
    session: u32,
    source: &str,
    folder: &Path,
    checkpoint: Checkpoint<'_>,
    progress: Progress<'_>,
) -> Result<PathBuf, String> {
    let target = destination(folder, source)?;
    match fs::symlink_metadata(&target) {
        Ok(_) => return Err("An item with this name already exists in the destination.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Could not check the destination: {error}")),
    }
    let stage = StageDirectory::beside(&target, "remote-folder")
        .map_err(|e| format!("Could not create a temporary folder: {e}"))?;
    let payload = stage.path.join("folder");
    let result: Result<(), String> = async {
        fs::create_dir(&payload).map_err(|e| e.to_string())?;
        let mut pending = vec![(source.to_owned(), payload.clone(), 0usize)];
        let mut checked = Vec::new();
        let mut count = 0usize;
        let mut completed_bytes = 0u64;
        progress(0, 0);
        while let Some((remote, local, depth)) = pending.pop() {
            checkpoint()?;
            if depth > MAX_DEPTH {
                return Err("The folder is nested too deeply to copy.".into());
            }
            let attrs = remotes.stat(profile, session, &remote).await?;
            if attrs.kind() != 0o040000 {
                return Err("A source folder changed during copying.".into());
            }
            let modified = attrs
                .modified
                .ok_or("The server did not provide a folder modification time.")?;
            let listing = remotes.list(profile, &remote, Some(session)).await?;
            if listing.omitted_entries > 0 {
                return Err(
                    "Some remote names cannot be represented; the folder was not copied.".into(),
                );
            }
            checked.push((remote.clone(), modified));
            for entry in listing.entries {
                checkpoint()?;
                count += 1;
                if count > MAX_ENTRIES {
                    return Err("The folder contains too many entries to copy.".into());
                }
                if !valid_windows_name(&entry.name) {
                    return Err(format!(
                        "The name {:?} cannot be saved on Windows.",
                        entry.name
                    ));
                }
                if entry.is_symlink {
                    return Err(format!("Links are not supported: {}", entry.path));
                }
                let child = format!("{}/{}", remote.trim_end_matches('/'), entry.name);
                if entry.is_dir {
                    let directory = local.join(&entry.name);
                    fs::create_dir(&directory)
                        .map_err(|e| format!("Could not create {}: {e}", directory.display()))?;
                    pending.push((child, directory, depth + 1));
                } else {
                    let file_bytes = std::cell::Cell::new(0u64);
                    let base = completed_bytes;
                    download_file(
                        remotes,
                        profile,
                        session,
                        &child,
                        &local,
                        checkpoint,
                        &mut |done, _| {
                            file_bytes.set(done);
                            progress(base.saturating_add(done), 0);
                        },
                    )
                    .await?;
                    completed_bytes = completed_bytes.saturating_add(file_bytes.get());
                }
            }
        }
        for (path, modified) in checked {
            checkpoint()?;
            let attrs = remotes.stat(profile, session, &path).await?;
            if attrs.kind() != 0o040000 || attrs.modified != Some(modified) {
                return Err("A source folder changed during copying.".into());
            }
        }
        checkpoint()?;
        rename_new(&payload, &target).map_err(|e| format!("Could not publish the folder: {e}"))?;
        Ok(())
    }
    .await;
    if let Err(error) = result {
        return match fs::remove_dir_all(&payload) {
            Ok(()) => Err(error),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(error),
            Err(e) => Err(format!(
                "{error} Could not remove {}: {e}",
                payload.display()
            )),
        };
    }
    Ok(target)
}

// Pin directories while they are being walked, excluding reparse points and
// preventing their names from being swapped for links during traversal.
fn pin_directory(path: &Path) -> Result<fs::File, String> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_SHARE_READ,
    };
    let file = fs::OpenOptions::new()
        .access_mode(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(format!(
            "Links and special folders cannot be copied: {}",
            path.display()
        ));
    }
    Ok(file)
}

pub(super) async fn remote_mkdir(session: &Arc<Session>, path: &str) -> Result<(), String> {
    remote_mkdir_with_permissions(session, path, false).await
}

pub(super) async fn remote_private_mkdir(session: &Arc<Session>, path: &str) -> Result<(), String> {
    remote_mkdir_with_permissions(session, path, true).await
}

async fn remote_mkdir_with_permissions(
    session: &Arc<Session>,
    path: &str,
    private: bool,
) -> Result<(), String> {
    let mut wire = session.wire.lock().await;
    session
        .complete(
            async {
                let mut payload = Vec::new();
                put_string(&mut payload, path.as_bytes());
                if private {
                    payload.extend_from_slice(&4u32.to_be_bytes());
                    payload.extend_from_slice(&0o700u32.to_be_bytes());
                } else {
                    payload.extend_from_slice(&0u32.to_be_bytes());
                }
                wire.request(Request::Mkdir, &payload, Reply::Status)
                    .await?;
                Ok(())
            },
            60,
        )
        .await
}

pub(in crate::services::remotes) async fn remote_remove(
    session: &Arc<Session>,
    path: &str,
    directory: bool,
) -> Result<(), String> {
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

pub(in crate::services::remotes) async fn remote_rename(
    session: &Arc<Session>,
    from: &str,
    to: &str,
) -> Result<(), String> {
    let mut wire = session.wire.lock().await;
    session
        .complete(
            async {
                let mut payload = Vec::new();
                put_string(&mut payload, from.as_bytes());
                put_string(&mut payload, to.as_bytes());
                wire.request(Request::Rename, &payload, Reply::Status)
                    .await?;
                Ok(())
            },
            60,
        )
        .await
}

pub(crate) async fn upload_entry(
    remotes: &Remotes,
    profile: &str,
    session_id: u32,
    source: &Path,
    folder: &str,
    checkpoint: Checkpoint<'_>,
    progress: Progress<'_>,
) -> Result<(String, EntryKind), String> {
    upload_entry_inner(
        remotes, profile, session_id, source, folder, checkpoint, progress, None,
    )
    .await
}

// Collect the exact objects copied, so move cleanup never rediscovers a tree.
pub(super) async fn upload_move_tree(
    remotes: &Remotes,
    profile: &str,
    session_id: u32,
    source: &Path,
    folder: &str,
    checkpoint: Checkpoint<'_>,
    progress: Progress<'_>,
    copied: &mut CopiedMoveSources,
) -> Result<String, String> {
    upload_entry_inner(
        remotes,
        profile,
        session_id,
        source,
        folder,
        checkpoint,
        progress,
        Some(copied),
    )
    .await
    .map(|(path, _)| path)
}

async fn upload_entry_inner(
    remotes: &Remotes,
    profile: &str,
    session_id: u32,
    source: &Path,
    folder: &str,
    checkpoint: Checkpoint<'_>,
    progress: Progress<'_>,
    mut copied: Option<&mut CopiedMoveSources>,
) -> Result<(String, EntryKind), String> {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    checkpoint()?;
    let meta =
        fs::symlink_metadata(source).map_err(|e| format!("Could not inspect the source: {e}"))?;
    if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("Links cannot be copied.".into());
    }
    if !meta.is_dir() {
        if copied.is_some() {
            return Err("The source folder changed before copying.".into());
        }
        return upload_file(
            remotes, profile, session_id, source, folder, checkpoint, progress,
        )
        .await
        .map(|path| (path, EntryKind::File));
    }
    check_path(folder, false).map_err(|e| e.message().to_owned())?;
    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .ok_or("The folder name cannot be represented on the remote host.")?;
    let target = format!("{}/{name}", folder.trim_end_matches('/'));
    check_path(&target, false).map_err(|e| e.message().to_owned())?;
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Could not create a temporary upload name.")?;
    let stage = format!(
        "{}/.stratum-upload-{:032x}.part",
        folder.trim_end_matches('/'),
        u128::from_le_bytes(random)
    );
    check_path(&stage, false).map_err(|e| e.message().to_owned())?;
    let session = remotes.current(profile, Some(session_id))?;
    remote_mkdir(&session, &stage)
        .await
        .map_err(|e| format!("{e} Check {stage} for an incomplete upload."))?;
    let mut created = vec![(stage.clone(), true)];
    let result: Result<(), String> = async {
        // Enter/leave frames keep ancestor handles pinned while walking children.
        enum Frame {
            Enter(PathBuf, String, usize),
            Leave(fs::File, std::time::SystemTime, Option<PinnedMoveSource>),
        }
        let mut pending = vec![Frame::Enter(source.to_path_buf(), stage.clone(), 0)];
        let mut count = 0usize;
        let mut completed_bytes = 0u64;
        progress(0, 0);
        while let Some(frame) = pending.pop() {
            checkpoint()?;
            match frame {
                Frame::Leave(guard, modified, pinned) => {
                    if guard.metadata().and_then(|m| m.modified()).ok() != Some(modified) {
                        return Err("A source folder changed during copying.".into());
                    }
                    if let Some(pinned) = pinned {
                        copied.as_deref_mut().unwrap().record(pinned);
                    }
                }
                Frame::Enter(local, remote, depth) => {
                    if depth > MAX_DEPTH {
                        return Err("The folder is nested too deeply to copy.".into());
                    }
                    let guard = pin_directory(&local)?;
                    let pinned = if copied.is_some() {
                        Some(PinnedMoveSource::open(&local, true)?)
                    } else {
                        None
                    };
                    if let Some(pinned) = &pinned {
                        pinned.matches(&guard)?;
                    }
                    let modified = guard
                        .metadata()
                        .and_then(|m| m.modified())
                        .map_err(|e| e.to_string())?;
                    let mut entries = Vec::new();
                    for entry in fs::read_dir(&local).map_err(|e| e.to_string())? {
                        checkpoint()?;
                        if entries.len() >= MAX_ENTRIES.saturating_sub(count) {
                            return Err("The folder contains too many entries to copy.".into());
                        }
                        entries.push(entry.map_err(|e| e.to_string())?);
                    }
                    pending.push(Frame::Leave(guard, modified, pinned));
                    for entry in entries {
                        checkpoint()?;
                        count += 1;
                        if count > MAX_ENTRIES {
                            return Err("The folder contains too many entries to copy.".into());
                        }
                        let name = entry
                            .file_name()
                            .into_string()
                            .map_err(|_| "A filename cannot be represented on the remote host.")?;
                        let child = format!("{remote}/{name}");
                        check_path(&child, false).map_err(|e| e.message().to_owned())?;
                        let meta = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
                        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                            return Err(format!(
                                "Links cannot be copied: {}",
                                entry.path().display()
                            ));
                        }
                        if meta.is_dir() {
                            remote_mkdir(&session, &child).await?;
                            created.push((child.clone(), true));
                            pending.push(Frame::Enter(entry.path(), child, depth + 1));
                        } else if meta.is_file() {
                            let pinned = if copied.is_some() {
                                Some(PinnedMoveSource::open(&entry.path(), false)?)
                            } else {
                                None
                            };
                            let file_bytes = std::cell::Cell::new(0u64);
                            let base = completed_bytes;
                            let uploaded = upload_file(
                                remotes,
                                profile,
                                session_id,
                                &entry.path(),
                                &remote,
                                checkpoint,
                                &mut |done, _| {
                                    file_bytes.set(done);
                                    progress(base.saturating_add(done), 0);
                                },
                            )
                            .await?;
                            if let Some(pinned) = pinned {
                                copied.as_deref_mut().unwrap().record(pinned);
                            }
                            completed_bytes = completed_bytes.saturating_add(file_bytes.get());
                            created.push((uploaded, false));
                        } else {
                            return Err(format!(
                                "Special files cannot be copied: {}",
                                entry.path().display()
                            ));
                        }
                    }
                }
            }
        }
        checkpoint()?;
        remote_rename(&session, &stage, &target)
            .await
            .map_err(|e| {
                format!("Could not publish the folder; the destination may already exist: {e}")
            })?;
        Ok(())
    }
    .await;
    if let Err(error) = result {
        let mut clean = true;
        for (path, directory) in created.iter().rev() {
            if remote_remove(&session, path, *directory).await.is_err() {
                clean = false;
            }
        }
        return if clean {
            Err(error)
        } else {
            Err(format!(
                "{error} Check {stage} and {target} for the upload's outcome."
            ))
        };
    }
    Ok((target, EntryKind::Directory))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_TEST_FOLDER to an empty test directory"]
    fn copies_folders_and_preserves_existing_empty_directories() {
        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let remote = std::env::var("STRATUM_SFTP_TEST_FOLDER").unwrap();
            let remotes = Remotes::default();
            let conn = remotes
                .connect("tree-test", &host, "", Arc::new(|_| {}))
                .await
                .unwrap();
            let session = remotes.current("tree-test", Some(conn.session_id)).unwrap();
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let root = std::env::temp_dir().join(format!(
                "stratum-tree-test-{:032x}",
                u128::from_le_bytes(random)
            ));
            let source = root.join("source");
            let output = root.join("output");
            fs::create_dir_all(source.join("nested")).unwrap();
            fs::create_dir_all(source.join("empty")).unwrap();
            fs::create_dir(&output).unwrap();
            fs::write(source.join("a.txt"), b"alpha").unwrap();
            fs::write(source.join("nested").join("b.txt"), b"beta").unwrap();
            let transferred = std::cell::Cell::new(0);
            let cancelled = upload_entry(
                &remotes,
                "tree-test",
                conn.session_id,
                &source,
                &remote,
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
            assert!(remotes
                .list("tree-test", &remote, Some(conn.session_id))
                .await
                .unwrap()
                .entries
                .is_empty());
            let (target, _) = upload_entry(
                &remotes,
                "tree-test",
                conn.session_id,
                &source,
                &remote,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            let transferred = std::cell::Cell::new(0);
            let cancelled = download_entry(
                &remotes,
                "tree-test",
                conn.session_id,
                &target,
                &output,
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
            assert!(fs::read_dir(&output).unwrap().next().is_none());
            let (local, _) = download_entry(
                &remotes,
                "tree-test",
                conn.session_id,
                &target,
                &output,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            assert_eq!(fs::read(local.join("a.txt")).unwrap(), b"alpha");
            assert_eq!(
                fs::read(local.join("nested").join("b.txt")).unwrap(),
                b"beta"
            );
            assert!(local.join("empty").is_dir());
            assert!(download_entry(
                &remotes,
                "tree-test",
                conn.session_id,
                &target,
                &output,
                &mut || Ok(()),
                &mut |_, _| {}
            )
            .await
            .is_err());
            assert!(upload_entry(
                &remotes,
                "tree-test",
                conn.session_id,
                &source,
                &remote,
                &mut || Ok(()),
                &mut |_, _| {}
            )
            .await
            .is_err());
            let empty_source = root.join("existing");
            fs::create_dir(&empty_source).unwrap();
            let empty_target = format!("{remote}/existing");
            remote_mkdir(&session, &empty_target).await.unwrap();
            fs::write(empty_source.join("must-not-appear"), b"new").unwrap();
            assert!(upload_entry(
                &remotes,
                "tree-test",
                conn.session_id,
                &empty_source,
                &remote,
                &mut || Ok(()),
                &mut |_, _| {}
            )
            .await
            .is_err());
            assert!(remotes
                .list("tree-test", &empty_target, Some(conn.session_id))
                .await
                .unwrap()
                .entries
                .is_empty());
            for path in [format!("{target}/nested/b.txt"), format!("{target}/a.txt")] {
                remote_remove(&session, &path, false).await.unwrap();
            }
            for path in [
                format!("{target}/nested"),
                format!("{target}/empty"),
                target,
                empty_target,
            ] {
                remote_remove(&session, &path, true).await.unwrap();
            }
            remotes.disconnect("tree-test").await;
            fs::remove_dir_all(root).unwrap();
        });
    }

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_UNSAFE_TREE to a fixture containing a link or invalid Windows name"]
    fn refuses_unsafe_remote_tree_without_publishing_partial_output() {
        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let source = std::env::var("STRATUM_SFTP_UNSAFE_TREE").unwrap();
            let remotes = Remotes::default();
            let conn = remotes
                .connect("unsafe-tree-test", &host, "", Arc::new(|_| {}))
                .await
                .unwrap();
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let folder = std::env::temp_dir().join(format!(
                "stratum-unsafe-tree-{:032x}",
                u128::from_le_bytes(random)
            ));
            fs::create_dir(&folder).unwrap();
            assert!(download_entry(
                &remotes,
                "unsafe-tree-test",
                conn.session_id,
                &source,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {}
            )
            .await
            .is_err());
            assert!(fs::read_dir(&folder).unwrap().next().is_none());
            remotes.disconnect("unsafe-tree-test").await;
            fs::remove_dir(folder).unwrap();
        });
    }
}
