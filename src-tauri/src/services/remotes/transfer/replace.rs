// Replacements preserve the old item as a sibling backup. A failed publish
// attempts to restore it, without ever replacing a concurrently created item.
use super::{
    destination, download_entry, remote_destination,
    tree::{remote_mkdir, remote_remove, remote_rename},
    upload_entry, Remotes, TransferResult,
};
use crate::domain::filesystem::staging::{rename_new, StageDirectory};
use std::{fs, path::Path};

fn random_name(prefix: &str) -> Result<String, String> {
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Could not create a backup name.")?;
    Ok(format!(
        ".stratum-{prefix}-{:032x}",
        u128::from_le_bytes(random)
    ))
}

pub(crate) async fn download(
    remotes: &Remotes,
    profile: &str,
    session: u32,
    source: &str,
    folder: &Path,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<TransferResult, String> {
    let target = destination(folder, source)?;
    let stage = StageDirectory::beside(&target, "remote-replace").map_err(|e| e.to_string())?;
    let prepared = download_entry(
        remotes,
        profile,
        session,
        source,
        &stage.path,
        checkpoint,
        progress,
    )
    .await?;
    let result = (|| {
        checkpoint()?;
        let backup = folder.join(random_name("backup")?);
        let saved = match rename_new(&target, &backup) {
            Ok(()) => true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(e) => return Err(format!("Could not preserve the existing item: {e}")),
        };
        if let Err(error) = rename_new(&prepared, &target) {
            if saved && rename_new(&backup, &target).is_err() {
                return Err(format!(
                    "Could not publish the copy: {error}. The original is at {}",
                    backup.display()
                ));
            }
            return Err(format!("Could not publish the copy: {error}"));
        }
        Ok(TransferResult {
            path: target.to_string_lossy().into_owned(),
            backup: saved.then(|| backup.to_string_lossy().into_owned()),
            warning: None,
            local_path: None,
        })
    })();
    if result.is_err() {
        let cleanup = if prepared.is_dir() {
            fs::remove_dir_all(&prepared)
        } else {
            fs::remove_file(&prepared)
        };
        if let Err(e) = cleanup {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!(
                    "{} Could not remove {}: {e}",
                    result.unwrap_err(),
                    prepared.display()
                ));
            }
        }
    }
    result
}

pub(crate) async fn upload(
    remotes: &Remotes,
    profile: &str,
    session_id: u32,
    source: &Path,
    folder: &str,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<TransferResult, String> {
    let target = remote_destination(source, folder)?;
    let source_is_file = fs::symlink_metadata(source)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false);
    let session = remotes.current(profile, Some(session_id))?;
    let stage = format!(
        "{}/{}",
        folder.trim_end_matches('/'),
        random_name("replace")?
    );
    super::super::browse::check_path(&stage, false).map_err(|error| error.message().to_owned())?;
    remote_mkdir(&session, &stage)
        .await
        .map_err(|error| format!("{error} Check {stage} for an incomplete upload."))?;
    let prepared = match upload_entry(
        remotes, profile, session_id, source, &stage, checkpoint, progress,
    )
    .await
    {
        Ok(path) => path,
        Err(error) => {
            return match remote_remove(&session, &stage, true).await {
                Ok(()) => Err(error),
                Err(_) => Err(format!("{error} Check {stage} for an incomplete upload.")),
            };
        }
    };
    let result: Result<TransferResult, String> = async {
        checkpoint()?;
        let backup = format!("{}/{}", folder.trim_end_matches('/'), random_name("backup")?);
        super::super::browse::check_path(&backup, false).map_err(|error| error.message().to_owned())?;
        let saved = remotes.exists(profile, session_id, &target).await?;
        if saved { remote_rename(&session, &target, &backup).await.map_err(|e| format!("Could not preserve the existing item: {e}. Check {target} and {backup} for the original."))?; }
        if let Err(error) = remote_rename(&session, &prepared, &target).await {
            if saved && remote_rename(&session, &backup, &target).await.is_err() {
                return Err(format!("Could not publish the copy: {error}. The original may be at {backup}; the staged copy is at {stage}."));
            }
            return Err(format!("Could not publish the copy: {error}. The staged copy is at {stage}."));
        }
        Ok(TransferResult { path: target.clone(), backup: saved.then_some(backup), warning: None, local_path: None })
    }.await;
    match result {
        Ok(mut output) => {
            // Only remove the empty stage; never recursively delete unknown names.
            if let Err(error) = remote_remove(&session, &stage, true).await {
                output.warning = Some(format!(
                    "The copy completed, but {stage} could not be removed: {error}"
                ));
            }
            Ok(output)
        }
        Err(error) => {
            // The file stage has one known child. For a staged tree, retain it
            // for recovery rather than recursively deleting unverified names.
            if source_is_file
                && remote_remove(&session, &prepared, false).await.is_ok()
                && remote_remove(&session, &stage, true).await.is_ok()
            {
                Err(error)
            } else {
                Err(format!(
                    "{error} Check {stage} and {target} for the upload's outcome."
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_TEST_FOLDER to an empty test directory"]
    fn replacement_preserves_originals_in_both_directions() {
        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let folder = std::env::var("STRATUM_SFTP_TEST_FOLDER").unwrap();
            let remotes = Remotes::default();
            let conn = remotes
                .connect("replace-test", &host, "", std::sync::Arc::new(|_| {}))
                .await
                .unwrap();
            let session = remotes
                .current("replace-test", Some(conn.session_id))
                .unwrap();
            let mut random = [0; 16];
            getrandom::fill(&mut random).unwrap();
            let root = std::env::temp_dir().join(format!(
                "stratum-replace-remote-{:032x}",
                u128::from_le_bytes(random)
            ));
            fs::create_dir(&root).unwrap();
            let source = root.join("file.txt");
            fs::write(&source, b"old remote").unwrap();
            let target = upload_entry(
                &remotes,
                "replace-test",
                conn.session_id,
                &source,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            fs::write(&source, b"new remote").unwrap();
            let transferred = std::cell::Cell::new(0);
            let cancelled = upload(
                &remotes,
                "replace-test",
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
            assert_eq!(
                remotes
                    .read_range("replace-test", conn.session_id, &target, 0, 100)
                    .await
                    .unwrap()
                    .bytes,
                b"old remote"
            );
            assert_eq!(
                remotes
                    .list("replace-test", &folder, Some(conn.session_id))
                    .await
                    .unwrap()
                    .entries
                    .len(),
                1
            );
            let output = upload(
                &remotes,
                "replace-test",
                conn.session_id,
                &source,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            assert_eq!(output.path, target);
            let backup = output.backup.unwrap();
            assert_eq!(
                remotes
                    .read_range("replace-test", conn.session_id, &target, 0, 100)
                    .await
                    .unwrap()
                    .bytes,
                b"new remote"
            );
            assert_eq!(
                remotes
                    .read_range("replace-test", conn.session_id, &backup, 0, 100)
                    .await
                    .unwrap()
                    .bytes,
                b"old remote"
            );
            fs::write(&source, b"old local").unwrap();
            let output = download(
                &remotes,
                "replace-test",
                conn.session_id,
                &target,
                &root,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            assert_eq!(fs::read(&source).unwrap(), b"new remote");
            assert_eq!(fs::read(output.backup.unwrap()).unwrap(), b"old local");
            remote_remove(&session, &target, false).await.unwrap();
            remote_remove(&session, &backup, false).await.unwrap();
            let tree = root.join("tree");
            fs::create_dir(&tree).unwrap();
            fs::write(tree.join("child.txt"), b"old folder").unwrap();
            let target_tree = upload_entry(
                &remotes,
                "replace-test",
                conn.session_id,
                &tree,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            fs::write(tree.join("child.txt"), b"new folder").unwrap();
            let output = upload(
                &remotes,
                "replace-test",
                conn.session_id,
                &tree,
                &folder,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            let backup_tree = output.backup.unwrap();
            assert_eq!(
                remotes
                    .read_range(
                        "replace-test",
                        conn.session_id,
                        &format!("{backup_tree}/child.txt"),
                        0,
                        100
                    )
                    .await
                    .unwrap()
                    .bytes,
                b"old folder"
            );
            fs::write(tree.join("child.txt"), b"local folder").unwrap();
            let output = download(
                &remotes,
                "replace-test",
                conn.session_id,
                &target_tree,
                &root,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            assert_eq!(fs::read(tree.join("child.txt")).unwrap(), b"new folder");
            assert_eq!(
                fs::read(Path::new(&output.backup.unwrap()).join("child.txt")).unwrap(),
                b"local folder"
            );
            for path in [&target_tree, &backup_tree] {
                remote_remove(&session, &format!("{path}/child.txt"), false)
                    .await
                    .unwrap();
                remote_remove(&session, path, true).await.unwrap();
            }
            remotes.disconnect("replace-test").await;
            fs::remove_dir_all(root).unwrap();
        });
    }
}
