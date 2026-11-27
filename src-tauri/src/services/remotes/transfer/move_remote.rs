// Save a recoverable source name before copying across a connection boundary.
use super::{
    destination_stage,
    move_source::CopiedSource,
    tree::{remote_private_mkdir, remote_rename},
    Direction, Transfer, TransferResult,
};
use crate::services::remotes::{
    browse,
    recovery::{stage_path, ActiveMove, RecoveryEntry},
    wire::{Fields, Reply, Request},
};

pub(crate) async fn move_entry(
    job: &Transfer,
    source: &str,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<TransferResult, String> {
    checkpoint()?;
    let journal = job.recovery.as_ref().ok_or("Could not prepare the move.")?;
    let session = job.remotes.current(&job.profile, Some(job.session))?;
    let initial = job.remotes.stat(&job.profile, job.session, source).await?;
    if let Some(expected) = &job.expected {
        if source.rsplit('/').next() != Some(expected.name.as_str())
            || !crate::services::remotes::operations::same_entry(expected, &initial)
        {
            return Err("The remote item changed. Refresh and try again.".into());
        }
    }
    if !matches!(initial.kind(), 0o100000 | 0o040000) {
        return Err("Links and special files cannot be moved.".into());
    }
    if initial.modified.is_none() {
        return Err("The server did not provide a modification time.".into());
    }
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Could not create a recovery ID.")?;
    let id = format!("{:032x}", u128::from_le_bytes(random));
    let _active = ActiveMove::start(&id)?;
    let (directory, staged) = stage_path(source, &id)?;
    let destination = match &job.direction {
        Direction::Download { local_folder, .. } => local_folder.to_string_lossy().into_owned(),
        Direction::Remote {
            dest_profile,
            remote_folder,
            ..
        } => format!("{dest_profile}:{remote_folder}"),
        Direction::Upload { .. } | Direction::Rename { .. } => {
            return Err("Invalid move destination.".into())
        }
    };
    let entry = RecoveryEntry {
        id: id.clone(),
        profile: job.profile.clone(),
        host: session.host.clone(),
        original: source.into(),
        stage: staged.clone(),
        destination,
        state: "planned".into(),
    };
    journal.insert(&entry)?;
    let result: Result<TransferResult, String> = async {
    remote_private_mkdir(&session, &directory)
        .await?;
    journal.state(&id, "prepared")?;
    checkpoint()?;
    // Recheck the parent and metadata immediately before the no-replace rename.
    let (parent, _) = source.rsplit_once('/').ok_or("Invalid remote source.")?;
    let parent = if parent.is_empty() { "/" } else { parent };
    {
        let mut wire = session.wire.lock().await;
        session
            .complete(
                async {
                    if browse::canonical(&mut wire, parent).await? != parent {
                        return Err(crate::services::remotes::wire::Error::Request(
                            "The source folder changed.".into(),
                        ));
                    }
                    let packet = wire
                        .path_request(Request::Lstat, source.as_bytes(), Reply::Attrs)
                        .await?;
                    let current = Fields(&packet).attrs()?;
                    if current.kind() != initial.kind()
                        || current.size != initial.size
                        || current.modified != initial.modified
                    {
                        return Err(crate::services::remotes::wire::Error::Request(
                            "The remote source changed.".into(),
                        ));
                    }
                    Ok(())
                },
                60,
            )
            .await?;
    }
    remote_rename(&session, source, &staged).await?;
    // Staging changes the source view before a potentially long copy starts.
    if let Some(notify) = &job.source_changed {
        notify(parent.to_owned());
    }
    journal.state(&id, "staged")?;
    let copied_source = CopiedSource::capture(&job.remotes, &job.profile, job.session, &staged, checkpoint).await?;
    let (path, _) = destination_stage::copy(job, &id, &staged, checkpoint, progress)
        .await?;
    let cleanup = async {
        journal.state(&id, "published")?;
        copied_source.remove(&job.remotes, &job.profile, job.session, &staged, &session).await?;
        Ok::<(), String>(())
    }.await;
    let warning = match cleanup {
        Ok(()) => {
            let directory_cleanup = super::tree::remote_remove(&session, &directory, true).await;
            let record_cleanup = journal.remove(&id);
            match (directory_cleanup, record_cleanup) {
                (Ok(()), Ok(())) => None,
                (directory_result, record_result) => Some(format!("Move completed. Temporary cleanup may be needed at {directory} on {}: {}", session.host, directory_result.err().or_else(|| record_result.err()).unwrap_or_default())),
            }
        }
        Err(error) => {
            let restored = crate::services::remotes::recovery::recover_active(&job.remotes, journal, &id, &job.profile, job.session).await;
            Some(match restored {
                Ok(()) => format!("Copy completed, but the original could not be fully removed: {error}. Check {source} on {}.", session.host),
                Err(_) => format!("Copy completed, but the original could not be fully removed: {error}. Remaining files may be at {staged} on {}.", session.host),
            })
        }
    };
    Ok(TransferResult {
        path,
        backup: None,
        warning,
        local_path: None,
    })
    }.await;
    if let Err(error) = result {
        let restored = crate::services::remotes::recovery::recover_active(
            &job.remotes,
            journal,
            &id,
            &job.profile,
            job.session,
        )
        .await;
        if let Some(notify) = &job.source_changed {
            if let Some((parent, _)) = source.rsplit_once('/') {
                notify(if parent.is_empty() { "/" } else { parent }.into());
            }
        }
        return Err(match restored {
            Ok(()) => error,
            Err(_) if error == "Transfer cancelled" => format!(
                "{}{} on {}",
                super::RECOVERY_CANCELLED_PREFIX,
                staged,
                session.host
            ),
            Err(_) => format!(
                "{error} The original may be at {staged} on {}; reconnect to restore it.",
                session.host
            ),
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::remotes::{
        recovery::{recover_active, test_journal},
        transfer::{
            tree::{remote_mkdir, remote_remove},
            upload_entry,
        },
    };
    use std::{fs, sync::Arc};

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_TEST_FOLDER to an empty test directory"]
    fn live_moves_finish_or_restore() {
        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let folder = std::env::var("STRATUM_SFTP_TEST_FOLDER").unwrap();
            let remotes = crate::services::remotes::Remotes::default();
            let source = remotes
                .connect("source", &host, "", Arc::new(|_| {}))
                .await
                .unwrap();
            let dest = remotes
                .connect("dest", &host, "", Arc::new(|_| {}))
                .await
                .unwrap();
            let session = remotes.current("source", Some(source.session_id)).unwrap();
            let src = format!("{folder}/source");
            let dst = format!("{folder}/destination");
            remote_mkdir(&session, &src).await.unwrap();
            remote_mkdir(&session, &dst).await.unwrap();
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let root = std::env::temp_dir().join(format!(
                "stratum-move-test-{:032x}",
                u128::from_le_bytes(random)
            ));
            fs::create_dir(&root).unwrap();
            let out = root.join("out");
            fs::create_dir(&out).unwrap();
            let journal = test_journal(&root.join("journal.sqlite"));
            let file = root.join("file.txt");
            fs::write(&file, b"file contents").unwrap();
            let remote_file = upload_entry(
                &remotes,
                "source",
                source.session_id,
                &file,
                &src,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            let mut job = Transfer {
                remotes: remotes.clone(),
                profile: "source".into(),
                session: source.session_id,
                direction: Direction::Download {
                    remote_path: remote_file.clone(),
                    local_folder: out.clone(),
                },
                replace: false,
                moving: true,
                recovery: Some(journal.clone()),
                expected: None,
                source_changed: None,
            };
            let result = move_entry(&job, &remote_file, &mut || Ok(()), &mut |_, _| {})
                .await
                .unwrap();
            assert!(result.warning.is_none());
            assert_eq!(fs::read(out.join("file.txt")).unwrap(), b"file contents");
            assert!(!remotes
                .exists("source", source.session_id, &remote_file)
                .await
                .unwrap());
            assert!(journal.list().unwrap().is_empty());
            assert!(journal.destination_stages().unwrap().is_empty());

            let tree = root.join("tree");
            fs::create_dir_all(tree.join("nested")).unwrap();
            fs::write(tree.join("nested/child.txt"), b"child").unwrap();
            let remote_tree = upload_entry(
                &remotes,
                "source",
                source.session_id,
                &tree,
                &src,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            job.direction = Direction::Remote {
                remote_path: remote_tree.clone(),
                dest_profile: "dest".into(),
                dest_session: dest.session_id,
                remote_folder: dst.clone(),
            };
            let result = move_entry(&job, &remote_tree, &mut || Ok(()), &mut |_, _| {})
                .await
                .unwrap();
            assert!(result.warning.is_none());
            assert!(!remotes
                .exists("source", source.session_id, &remote_tree)
                .await
                .unwrap());
            assert_eq!(
                remotes
                    .read_range(
                        "dest",
                        dest.session_id,
                        &format!("{dst}/tree/nested/child.txt"),
                        0,
                        5
                    )
                    .await
                    .unwrap()
                    .bytes,
                b"child"
            );
            assert!(journal.list().unwrap().is_empty());

            let mutable = root.join("mutable.txt");
            let replacement = root.join("replacement.txt");
            fs::write(&mutable, b"before").unwrap();
            fs::write(&replacement, b"changed contents").unwrap();
            let remote_mutable = upload_entry(
                &remotes,
                "source",
                source.session_id,
                &mutable,
                &src,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            let remote_replacement = upload_entry(
                &remotes,
                "source",
                source.session_id,
                &replacement,
                &src,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            let captured = CopiedSource::capture(
                &remotes,
                "source",
                source.session_id,
                &remote_mutable,
                &mut || Ok(()),
            )
            .await
            .unwrap();
            remote_remove(&session, &remote_mutable, false)
                .await
                .unwrap();
            remote_rename(&session, &remote_replacement, &remote_mutable)
                .await
                .unwrap();
            assert!(captured
                .remove(
                    &remotes,
                    "source",
                    source.session_id,
                    &remote_mutable,
                    &session
                )
                .await
                .is_err());
            assert_eq!(
                remotes
                    .read_range("source", source.session_id, &remote_mutable, 0, 16)
                    .await
                    .unwrap()
                    .bytes,
                b"changed contents"
            );
            remote_remove(&session, &remote_mutable, false)
                .await
                .unwrap();

            let large = root.join("large.bin");
            fs::write(&large, vec![7u8; 500_000]).unwrap();
            let remote_large = upload_entry(
                &remotes,
                "source",
                source.session_id,
                &large,
                &src,
                &mut || Ok(()),
                &mut |_, _| {},
            )
            .await
            .unwrap();
            let sent = std::cell::Cell::new(false);
            let cancelled = move_entry(
                &job,
                &remote_large,
                &mut || {
                    if sent.get() {
                        Err("Transfer cancelled".into())
                    } else {
                        Ok(())
                    }
                },
                &mut |n, _| {
                    if n > 0 {
                        sent.set(true)
                    }
                },
            )
            .await;
            assert_eq!(cancelled.unwrap_err(), "Transfer cancelled");
            assert!(remotes
                .exists("source", source.session_id, &remote_large)
                .await
                .unwrap());
            assert!(!remotes
                .exists("dest", dest.session_id, &format!("{dst}/large.bin"))
                .await
                .unwrap());
            assert!(journal.list().unwrap().is_empty());

            let disconnected = std::cell::Cell::new(false);
            let interrupted = move_entry(
                &job,
                &remote_large,
                &mut || {
                    if disconnected.get() {
                        session.stop.send_replace(true);
                    }
                    Ok(())
                },
                &mut |n, _| {
                    if n > 0 {
                        disconnected.set(true)
                    }
                },
            )
            .await;
            assert!(interrupted.is_err());
            assert_eq!(journal.list().unwrap().len(), 1);
            remotes.disconnect("source").await;
            let reconnected = remotes
                .connect("source", &host, "", Arc::new(|_| {}))
                .await
                .unwrap();
            let record = journal.list().unwrap().pop().unwrap();
            recover_active(
                &remotes,
                &journal,
                &record.id,
                "source",
                reconnected.session_id,
            )
            .await
            .unwrap();
            assert!(remotes
                .exists("source", reconnected.session_id, &remote_large)
                .await
                .unwrap());
            assert!(journal.list().unwrap().is_empty());
            let session = remotes
                .current("source", Some(reconnected.session_id))
                .unwrap();
            for p in [&remote_large, &format!("{dst}/tree/nested/child.txt")] {
                remote_remove(&session, p, false).await.unwrap();
            }
            for p in [
                &format!("{dst}/tree/nested"),
                &format!("{dst}/tree"),
                &src,
                &dst,
            ] {
                remote_remove(&session, p, true).await.unwrap();
            }
            remotes.disconnect("source").await;
            remotes.disconnect("dest").await;
            fs::remove_dir_all(root).unwrap();
        });
    }
}
