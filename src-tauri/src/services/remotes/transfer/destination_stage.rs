// Give each remote-origin move a journalled destination workspace. Nested
// transfer stages stay inside it, so a crash leaves one identifiable root.
use super::{
    remote_copy,
    tree::{remote_private_mkdir, remote_remove, remote_rename},
    Direction, Transfer,
};
use crate::{
    domain::filesystem::staging::{rename_new, StageDirectory},
    services::remotes::{browse, recovery::DestinationStage},
};
use std::fs;

pub(super) async fn copy(
    job: &Transfer,
    id: &str,
    source: &str,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(String, Option<String>, super::EntryKind), String> {
    let journal = job
        .recovery
        .as_ref()
        .ok_or("Could not prepare the transfer.")?;
    let name = source
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .ok_or("Invalid source name.")?;
    let stage_name = format!(".stratum-move-copy-{id}");
    let source_session = job.remotes.current(&job.profile, Some(job.session))?;
    match &job.direction {
        Direction::Download {
            local_folder,
            remote_path,
        } => {
            let target = super::destination(local_folder, source)?;
            let path = local_folder.join(&stage_name);
            journal.track_destination(
                &DestinationStage {
                    id: id.into(),
                    kind: "local".into(),
                    host: String::new(),
                    folder: local_folder.to_string_lossy().into_owned(),
                    path: path.to_string_lossy().into_owned(),
                    identity: None,
                },
                &source_session.host,
                remote_path,
            )?;
            let stage = StageDirectory::create(path.clone())
                .map_err(|e| format!("Could not create destination staging: {e}"))?;
            journal.destination_identity(id, &stage.identity().map_err(|e| e.to_string())?)?;
            let result = async {
                let (payload, kind) = super::download_entry(
                    &job.remotes,
                    &job.profile,
                    job.session,
                    source,
                    &path,
                    checkpoint,
                    progress,
                )
                .await?;
                checkpoint()?;
                rename_new(&payload, &target)
                    .map_err(|e| format!("Could not publish the download: {e}"))?;
                Ok((target.to_string_lossy().into_owned(), None, kind))
            }
            .await;
            drop(stage);
            if matches!(fs::symlink_metadata(&path), Err(ref e) if e.kind() == std::io::ErrorKind::NotFound)
            {
                let _ = journal.clear_destination(id);
            }
            result
        }
        Direction::Remote {
            dest_profile,
            dest_session,
            remote_folder,
            remote_path,
        } => {
            let session = job.remotes.current(dest_profile, Some(*dest_session))?;
            let stage = format!("{}/{stage_name}", remote_folder.trim_end_matches('/'));
            let target = format!("{}/{name}", remote_folder.trim_end_matches('/'));
            browse::check_path(&stage, false).map_err(|e| e.message().to_owned())?;
            browse::check_path(&target, false).map_err(|e| e.message().to_owned())?;
            {
                let mut wire = session.wire.lock().await;
                session
                    .complete(
                        async {
                            if browse::canonical(&mut wire, remote_folder).await? != *remote_folder
                            {
                                return Err(crate::services::remotes::wire::Error::Request(
                                    "The destination folder changed.".into(),
                                ));
                            }
                            Ok(())
                        },
                        60,
                    )
                    .await?;
            }
            journal.track_destination(
                &DestinationStage {
                    id: id.into(),
                    kind: "remote".into(),
                    host: session.host.clone(),
                    folder: remote_folder.clone(),
                    path: stage.clone(),
                    identity: None,
                },
                &source_session.host,
                remote_path,
            )?;
            remote_private_mkdir(&session, &stage).await?;
            // Do not offer automatic deletion if creation was never confirmed.
            journal.destination_identity(id, "created")?;
            let result = async {
                let (payload, kind) = remote_copy::copy_entry(
                    &job.remotes,
                    (&job.profile, job.session),
                    (dest_profile, *dest_session),
                    source,
                    &stage,
                    checkpoint,
                    progress,
                )
                .await?;
                checkpoint()?;
                let backup = format!(
                    "{}/.stratum-backup-{id}",
                    remote_folder.trim_end_matches('/')
                );
                let saved = if job.replace
                    && job
                        .remotes
                        .exists(dest_profile, *dest_session, &target)
                        .await?
                {
                    remote_rename(&session, &target, &backup).await?;
                    true
                } else {
                    false
                };
                if let Err(error) = remote_rename(&session, &payload, &target).await {
                    if saved && remote_rename(&session, &backup, &target).await.is_err() {
                        return Err(format!(
                            "{error} The original may be at {backup}; check the destination."
                        ));
                    }
                    return Err(error);
                }
                Ok((target, saved.then_some(backup), kind))
            }
            .await;
            if remote_remove(&session, &stage, true).await.is_ok() {
                let _ = journal.clear_destination(id);
            } else if result.is_err() {
                return result
                    .map_err(|error| format!("{error} Temporary files may remain at {stage}."));
            }
            result
        }
        Direction::Upload { .. } | Direction::Rename { .. } => {
            Err("Invalid move destination.".into())
        }
    }
}
