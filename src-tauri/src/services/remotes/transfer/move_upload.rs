// Move a local regular file only while an exclusive Windows source handle is
// held. The handle denies writers and renames throughout upload and deletion.
use super::{tree::upload_move_tree, upload::upload_open_file, Remotes, TransferResult};
use super::{EntryKind, ItemCompletion};
use crate::domain::filesystem::transfer::CopiedMoveSources;
use std::{
    fs,
    mem::size_of,
    os::windows::{
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    },
    path::Path,
};
use windows_sys::Win32::Storage::FileSystem::{
    FileDispositionInfo, SetFileInformationByHandle, DELETE, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_DISPOSITION_INFO, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_READ_DATA,
    FILE_SHARE_READ,
};

pub(crate) async fn move_file(
    remotes: &Remotes,
    profile: &str,
    session: u32,
    source: &Path,
    folder: &str,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<TransferResult, String> {
    checkpoint()?;
    let metadata =
        fs::symlink_metadata(source).map_err(|e| format!("Could not inspect the source: {e}"))?;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("Links cannot be moved to a remote folder.".into());
    }
    if metadata.is_dir() {
        let mut copied = CopiedMoveSources::default();
        let path = upload_move_tree(
            remotes,
            profile,
            session,
            source,
            folder,
            checkpoint,
            progress,
            &mut copied,
        )
        .await?;
        return Ok(finish_move(
            path,
            EntryKind::Directory,
            checkpoint,
            |target| {
                copied
                    .remove(target)
                    .map_err(|error| format!("Move cleanup was incomplete: {error}"))
            },
        ));
    }
    let file = fs::OpenOptions::new()
        .access_mode(FILE_READ_DATA | FILE_READ_ATTRIBUTES | DELETE)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(source)
        .map_err(|e| format!("Could not lock the source for moving: {e}"))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("Only regular files can be moved to a remote folder currently.".into());
    }
    let reader = file
        .try_clone()
        .map_err(|e| format!("Could not read the source: {e}"))?;
    let path = upload_open_file(
        remotes, profile, session, source, reader, folder, checkpoint, progress,
    )
    .await?;
    Ok(finish_move(path, EntryKind::File, checkpoint, |target| {
        let disposition = FILE_DISPOSITION_INFO { DeleteFile: 1 };
        let removed = unsafe {
            SetFileInformationByHandle(
                file.as_raw_handle() as isize,
                FileDispositionInfo,
                (&disposition as *const FILE_DISPOSITION_INFO).cast(),
                size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        };
        if removed == 0 {
            Err(format!(
                "Copied to {target}, but the original was kept: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }))
}

// The destination is published. A move becomes confirmed only when its source is removed.
fn finish_move(
    path: String,
    kind: EntryKind,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
    remove_source: impl FnOnce(&str) -> Result<(), String>,
) -> TransferResult {
    let (completion, warning) = match checkpoint() {
        Err(error) if error == crate::domain::filesystem::transfer::TRANSFER_CANCELLED_MESSAGE => (
            ItemCompletion::Cancelled,
            Some(format!(
                "Copied to {path}; the original was kept because the move was cancelled."
            )),
        ),
        Err(error) => (
            ItemCompletion::Incomplete,
            Some(format!(
                "Copied to {path}, but the original was kept: {error}"
            )),
        ),
        Ok(()) => match remove_source(&path) {
            Ok(()) => (ItemCompletion::Confirmed(kind), None),
            Err(warning) => (ItemCompletion::Incomplete, Some(warning)),
        },
    };
    TransferResult {
        completion,
        path,
        backup: None,
        warning,
        local_path: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::remotes::transfer::tree::remote_remove;
    use std::sync::Arc;

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_TEST_FOLDER to an empty test directory"]
    fn move_file_keeps_sources_on_conflict_or_cancellation() {
        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let folder = std::env::var("STRATUM_SFTP_TEST_FOLDER").unwrap();
            let remotes = Remotes::default();
            let conn = remotes
                .connect("move-upload-test", &host, "", Arc::new(|_| {}))
                .await
                .unwrap();
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let root = std::env::temp_dir().join(format!(
                "stratum-move-test-{:032x}",
                u128::from_le_bytes(random)
            ));
            fs::create_dir(&root).unwrap();
            let source = root.join("move.bin");
            let data = vec![42u8; 200_000];
            fs::write(&source, &data).unwrap();
            let transferred = std::cell::Cell::new(0);
            let cancelled = move_file(
                &remotes,
                "move-upload-test",
                conn.session_id,
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
            assert_eq!(fs::read(&source).unwrap(), data);
            let checked_lock = std::cell::Cell::new(false);
            let mut checkpoints = 0;
            let result = move_file(
                &remotes,
                "move-upload-test",
                conn.session_id,
                &source,
                &folder,
                &mut || {
                    checkpoints += 1;
                    Ok(())
                },
                &mut |_, _| {
                    if !checked_lock.replace(true) {
                        assert!(fs::write(&source, b"changed").is_err());
                    }
                },
            )
            .await
            .unwrap();
            assert!(checked_lock.get());
            assert!(result.warning.is_none());
            assert!(!source.exists());
            let copied = remotes
                .read_range(
                    "move-upload-test",
                    conn.session_id,
                    &result.path,
                    0,
                    data.len(),
                )
                .await
                .unwrap();
            assert_eq!(copied.bytes, data);
            fs::write(&source, b"new source").unwrap();
            assert!(move_file(
                &remotes,
                "move-upload-test",
                conn.session_id,
                &source,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {}
            )
            .await
            .is_err());
            assert_eq!(fs::read(&source).unwrap(), b"new source");
            let session = remotes
                .current("move-upload-test", Some(conn.session_id))
                .unwrap();
            remote_remove(&session, &result.path, false).await.unwrap();
            // Replay the same file and cancel at the final, post-publication checkpoint.
            fs::write(&source, &data).unwrap();
            let mut remaining = checkpoints;
            let retained = move_file(
                &remotes,
                "move-upload-test",
                conn.session_id,
                &source,
                &folder,
                &mut || {
                    remaining -= 1;
                    if remaining == 0 {
                        Err("Transfer cancelled".into())
                    } else {
                        Ok(())
                    }
                },
                &mut |_, _| {},
            )
            .await
            .unwrap();
            assert_eq!(retained.completion, ItemCompletion::Cancelled);
            assert_eq!(fs::read(&source).unwrap(), data);
            assert!(remotes
                .exists("move-upload-test", conn.session_id, &retained.path)
                .await
                .unwrap());
            remote_remove(&session, &retained.path, false)
                .await
                .unwrap();
            remotes.disconnect("move-upload-test").await;
            fs::remove_dir_all(root).unwrap();
        });
    }

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_TEST_FOLDER to an empty test directory"]
    fn move_folders_preserves_changed_sources_and_refuses_conflicts() {
        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let folder = std::env::var("STRATUM_SFTP_TEST_FOLDER").unwrap();
            let remotes = Remotes::default();
            let conn = remotes
                .connect("move-tree-test", &host, "", Arc::new(|_| {}))
                .await
                .unwrap();
            let session = remotes
                .current("move-tree-test", Some(conn.session_id))
                .unwrap();
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let root = std::env::temp_dir().join(format!(
                "stratum-move-tree-{:032x}",
                u128::from_le_bytes(random)
            ));
            let source = root.join("tree");
            fs::create_dir_all(source.join("nested")).unwrap();
            fs::create_dir(source.join("empty")).unwrap();
            fs::write(source.join("nested").join("file.txt"), b"original").unwrap();
            let copied_bytes = std::cell::Cell::new(0);
            let cancelled = move_file(
                &remotes,
                "move-tree-test",
                conn.session_id,
                &source,
                &folder,
                &mut || {
                    if copied_bytes.get() > 0 {
                        Err("Cancelled".into())
                    } else {
                        Ok(())
                    }
                },
                &mut |done, _| copied_bytes.set(done),
            )
            .await;
            assert_eq!(cancelled.unwrap_err(), "Cancelled");
            assert_eq!(
                fs::read(source.join("nested").join("file.txt")).unwrap(),
                b"original"
            );
            assert!(remotes
                .list("move-tree-test", &folder, Some(conn.session_id))
                .await
                .unwrap()
                .entries
                .is_empty());
            let result = move_file(
                &remotes,
                "move-tree-test",
                conn.session_id,
                &source,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            assert!(result.warning.is_none(), "{:?}", result.warning);
            assert!(!source.exists());
            let remote_file = format!("{}/nested/file.txt", result.path);
            assert_eq!(
                remotes
                    .read_range("move-tree-test", conn.session_id, &remote_file, 0, 8)
                    .await
                    .unwrap()
                    .bytes,
                b"original"
            );
            assert!(remotes
                .list(
                    "move-tree-test",
                    &format!("{}/empty", result.path),
                    Some(conn.session_id)
                )
                .await
                .unwrap()
                .entries
                .is_empty());
            fs::create_dir_all(&source).unwrap();
            fs::write(source.join("kept.txt"), b"kept").unwrap();
            assert!(move_file(
                &remotes,
                "move-tree-test",
                conn.session_id,
                &source,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {}
            )
            .await
            .is_err());
            assert_eq!(fs::read(source.join("kept.txt")).unwrap(), b"kept");
            let changing = root.join("changing");
            fs::create_dir(&changing).unwrap();
            let changed_file = changing.join("file.txt");
            fs::write(&changed_file, b"old").unwrap();
            let copied = std::cell::Cell::new(false);
            let changed = std::cell::Cell::new(false);
            let changed_result = move_file(
                &remotes,
                "move-tree-test",
                conn.session_id,
                &changing,
                &folder,
                &mut || {
                    if copied.get() && !changed.get() && fs::write(&changed_file, b"new").is_ok() {
                        changed.set(true);
                    }
                    Ok(())
                },
                &mut |done, _| {
                    if done > 0 {
                        copied.set(true);
                    }
                },
            )
            .await
            .unwrap();
            assert!(changed.get());
            assert!(changed_result.warning.is_some());
            assert_eq!(changed_result.completion, ItemCompletion::Incomplete);
            assert_eq!(fs::read(&changed_file).unwrap(), b"new");
            assert_eq!(
                remotes
                    .read_range(
                        "move-tree-test",
                        conn.session_id,
                        &format!("{}/file.txt", changed_result.path),
                        0,
                        3
                    )
                    .await
                    .unwrap()
                    .bytes,
                b"old"
            );
            // Junctions must not be traversed while uploading or deleting.
            let outside = root.join("outside");
            let linked = root.join("linked");
            fs::create_dir(&outside).unwrap();
            fs::write(outside.join("keep.txt"), b"outside").unwrap();
            fs::create_dir(&linked).unwrap();
            let junction = linked.join("junction");
            let status = std::process::Command::new("cmd.exe")
                .args(["/d", "/c", "mklink", "/J"])
                .arg(&junction)
                .arg(&outside)
                .output()
                .unwrap();
            assert!(status.status.success(), "{status:?}");
            assert!(move_file(
                &remotes,
                "move-tree-test",
                conn.session_id,
                &linked,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {}
            )
            .await
            .is_err());
            assert_eq!(fs::read(outside.join("keep.txt")).unwrap(), b"outside");
            assert!(junction.exists());
            assert!(!remotes
                .exists(
                    "move-tree-test",
                    conn.session_id,
                    &format!("{folder}/linked")
                )
                .await
                .unwrap());
            fs::remove_dir(&junction).unwrap();
            for path in [&remote_file, &format!("{}/file.txt", changed_result.path)] {
                remote_remove(&session, path, false).await.unwrap();
            }
            for path in [
                format!("{}/nested", result.path),
                format!("{}/empty", result.path),
                result.path,
                changed_result.path,
            ] {
                remote_remove(&session, &path, true).await.unwrap();
            }
            remotes.disconnect("move-tree-test").await;
            fs::remove_dir_all(root).unwrap();
        });
    }
}
