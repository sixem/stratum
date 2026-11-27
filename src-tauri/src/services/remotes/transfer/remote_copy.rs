// Stream remote files between sessions in bounded chunks. The destination is
// published only after every item has been copied into a staging directory.
use super::{
    tree::{remote_mkdir, remote_private_mkdir, remote_remove, remote_rename},
    upload::UploadStage,
    Remotes,
};
use crate::services::remotes::browse::check_path;
use crate::services::remotes::file;

// A journalled destination stage makes interrupted copies recoverable too.
pub(crate) async fn copy_transfer(
    job: &super::Transfer,
    checkpoint: Checkpoint<'_>,
    progress: Progress<'_>,
) -> Result<super::TransferResult, String> {
    let super::Direction::Remote {
        remote_path,
        dest_profile,
        dest_session,
        remote_folder,
    } = &job.direction
    else {
        return Err("Invalid copy destination.".into());
    };
    checkpoint()?;
    let source = job.remotes.current(&job.profile, Some(job.session))?;
    let destination = job.remotes.current(dest_profile, Some(*dest_session))?;
    let attrs = job
        .remotes
        .stat(&job.profile, job.session, remote_path)
        .await?;
    if let Some(expected) = &job.expected {
        if remote_path.rsplit('/').next() != Some(expected.name.as_str())
            || !crate::services::remotes::operations::same_entry(expected, &attrs)
        {
            return Err("The remote item changed. Refresh and try again.".into());
        }
    }
    if source.host == destination.host
        && invalid_same_host_destination(remote_path, remote_folder, attrs.kind() == 0o040000)
    {
        return Err("Choose a different destination outside the source folder.".into());
    }
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Could not create a copy staging ID.")?;
    let id = format!("{:032x}", u128::from_le_bytes(random));
    let _active = crate::services::remotes::recovery::ActiveMove::start(&id)?;
    let (path, backup) =
        super::destination_stage::copy(job, &id, remote_path, checkpoint, progress).await?;
    Ok(super::TransferResult {
        path,
        backup,
        warning: None,
        local_path: None,
    })
}

type Checkpoint<'a> = &'a mut dyn FnMut() -> Result<(), String>;
type Progress<'a> = &'a mut dyn FnMut(u64, u64);

// A copy must not replace its own source or create staging inside the tree
// being traversed, including when both panes share one SFTP connection.
fn invalid_same_host_destination(source: &str, folder: &str, is_dir: bool) -> bool {
    let parent = source
        .rsplit_once('/')
        .map(|(p, _)| if p.is_empty() { "/" } else { p })
        .unwrap_or("/");
    folder == parent || (is_dir && (folder == source || folder.starts_with(&format!("{source}/"))))
}

#[cfg(test)]
mod tests {
    use super::invalid_same_host_destination;

    #[test]
    fn same_host_copy_rejects_self_and_descendants() {
        assert!(invalid_same_host_destination("/data/tree", "/data", true));
        assert!(invalid_same_host_destination(
            "/data/tree",
            "/data/tree",
            true
        ));
        assert!(invalid_same_host_destination(
            "/data/tree",
            "/data/tree/sub",
            true
        ));
        assert!(!invalid_same_host_destination(
            "/data/tree",
            "/data/trees",
            true
        ));
        assert!(!invalid_same_host_destination(
            "/data/file",
            "/other",
            false
        ));
        assert!(invalid_same_host_destination("/file", "/", false));
    }

    #[test]
    #[ignore = "requires the disposable SFTP range file and transfer folder"]
    fn pipelined_copy_on_one_session_preserves_every_byte() {
        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let source = std::env::var("STRATUM_SFTP_TEST_RANGE").unwrap();
            let folder = std::env::var("STRATUM_SFTP_TEST_FOLDER").unwrap();
            let remotes = super::Remotes::default();
            let profile = "copy-window";
            let connected = remotes
                .connect(profile, &host, &folder, std::sync::Arc::new(|_| {}))
                .await
                .unwrap();
            let id = connected.session_id;
            let mut progress = Vec::new();
            let target = super::copy_file(
                &remotes,
                (profile, id),
                (profile, id),
                &source,
                &folder,
                &mut || Ok(()),
                &mut |done, _| progress.push(done),
            )
            .await
            .unwrap();
            let expected = remotes
                .read_range(profile, id, &source, 0, super::file::MAX_READ)
                .await
                .unwrap();
            assert!(expected.size > super::file::WINDOW_BYTES as u64);
            assert_eq!(progress.last().copied(), Some(expected.size));
            let actual = remotes
                .read_range(profile, id, &target, 0, super::file::MAX_READ)
                .await
                .unwrap();
            assert_eq!(actual.size, expected.size);
            assert_eq!(actual.bytes, expected.bytes);
            super::remote_remove(&remotes.current(profile, Some(id)).unwrap(), &target, false)
                .await
                .unwrap();
            remotes.disconnect(profile).await;
        });
    }
}

async fn copy_file(
    remotes: &Remotes,
    src: (&str, u32),
    dst: (&str, u32),
    source: &str,
    folder: &str,
    checkpoint: Checkpoint<'_>,
    progress: Progress<'_>,
) -> Result<String, String> {
    let name = source
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .ok_or("Invalid source name.")?;
    let target = format!("{}/{name}", folder.trim_end_matches('/'));
    check_path(&target, false).map_err(|e| e.message().to_owned())?;
    let initial = remotes.stat(src.0, src.1, source).await?;
    let size = initial
        .size
        .ok_or("The server did not provide the file size.")?;
    if initial.modified.is_none() {
        return Err("The server did not provide a modification time.".into());
    }
    let session = remotes.current(dst.0, Some(dst.1))?;
    let mut stage = UploadStage::create(session, folder).await?;
    let result: Result<(), String> = async {
        let reader = remotes.current(src.0, Some(src.1))?;
        let handle = {
            let mut wire = reader.wire.lock().await;
            reader
                .complete(file::open_regular(&mut wire, source), 60)
                .await?
        };
        let copied: Result<(), String> = async {
            let mut offset = 0u64;
            progress(0, size);
            loop {
                checkpoint()?;
                let attrs = remotes.stat(src.0, src.1, source).await?;
                if attrs.kind() != 0o100000
                    || attrs.size != Some(size)
                    || attrs.modified != initial.modified
                {
                    return Err("The remote source changed while copying.".into());
                }
                let count = (size - offset).min(file::WINDOW_BYTES as u64) as usize;
                let bytes = {
                    let mut wire = reader.wire.lock().await;
                    if reader
                        .complete(file::metadata(&mut wire, &handle), 60)
                        .await?
                        != (size, initial.modified)
                    {
                        return Err("The remote source changed while copying.".into());
                    }
                    if count == 0 {
                        break;
                    }
                    reader
                        .complete(file::read_window(&mut wire, &handle, offset, count), 60)
                        .await?
                };
                // Release the source wire before writing, even on a shared session.
                checkpoint()?;
                stage.write(offset, &bytes).await?;
                offset += bytes.len() as u64;
                progress(offset, size);
            }
            Ok(())
        }
        .await;
        let closed = {
            let mut wire = reader.wire.lock().await;
            reader.complete(wire.close(&handle), 60).await
        };
        copied?;
        closed?;
        checkpoint()?;
        stage.publish(&target).await?;
        Ok(())
    }
    .await;
    if let Err(error) = result {
        return match stage.remove().await {
            Ok(()) => Err(error),
            Err(_) => Err(format!("{error} Check {target} for the copy's outcome.")),
        };
    }
    Ok(target)
}

pub(super) async fn copy_entry(
    remotes: &Remotes,
    src: (&str, u32),
    dst: (&str, u32),
    source: &str,
    folder: &str,
    checkpoint: Checkpoint<'_>,
    progress: Progress<'_>,
) -> Result<String, String> {
    checkpoint()?;
    check_path(folder, false).map_err(|e| e.message().to_owned())?;
    let kind = remotes.stat(src.0, src.1, source).await?.kind();
    if kind == 0o100000 {
        return copy_file(remotes, src, dst, source, folder, checkpoint, progress).await;
    }
    if kind != 0o040000 {
        return Err("Links and special files cannot be copied.".into());
    }
    let name = source
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .ok_or("Invalid source name.")?;
    let target = format!("{}/{name}", folder.trim_end_matches('/'));
    check_path(&target, false).map_err(|e| e.message().to_owned())?;
    let mut random = [0u8; 16];
    getrandom::fill(&mut random).map_err(|_| "Could not create a copy staging name.")?;
    let stage = format!(
        "{}/.stratum-copy-{:032x}",
        folder.trim_end_matches('/'),
        u128::from_le_bytes(random)
    );
    let session = remotes.current(dst.0, Some(dst.1))?;
    remote_private_mkdir(&session, &stage).await?;
    let mut created = vec![(stage.clone(), true)];
    let result: Result<(), String> = async {
        // Keep incomplete contents private without leaving the final folder at 0700.
        let payload = format!("{stage}/{name}");
        remote_mkdir(&session, &payload).await?;
        created.push((payload.clone(), true));
        let mut pending = vec![(source.to_owned(), payload.clone(), 0usize)];
        let mut checked = Vec::new();
        let mut count = 0usize;
        let mut bytes = 0u64;
        while let Some((from, to, depth)) = pending.pop() {
            checkpoint()?;
            if depth > 64 {
                return Err("The folder is nested too deeply to copy.".into());
            }
            let attrs = remotes.stat(src.0, src.1, &from).await?;
            if attrs.kind() != 0o040000 {
                return Err("A source folder changed while copying.".into());
            }
            let modified = attrs
                .modified
                .ok_or("The server did not provide a folder modification time.")?;
            let listing = remotes.list(src.0, &from, Some(src.1)).await?;
            if listing.omitted_entries > 0 {
                return Err("Some remote names could not be represented.".into());
            }
            checked.push((from.clone(), modified));
            for entry in listing.entries {
                checkpoint()?;
                count += 1;
                if count > 100_000 {
                    return Err("The folder contains too many entries to copy.".into());
                }
                if entry.is_symlink {
                    return Err(format!("Links cannot be copied: {}", entry.path));
                }
                let from_child = format!("{}/{}", from.trim_end_matches('/'), entry.name);
                let to_child = format!("{to}/{}", entry.name);
                check_path(&to_child, false).map_err(|e| e.message().to_owned())?;
                if entry.is_dir {
                    remote_mkdir(&session, &to_child).await?;
                    created.push((to_child.clone(), true));
                    pending.push((from_child, to_child, depth + 1));
                } else {
                    let done = std::cell::Cell::new(0);
                    let base = bytes;
                    let path = copy_file(
                        remotes,
                        src,
                        dst,
                        &from_child,
                        &to,
                        checkpoint,
                        &mut |n, _| {
                            done.set(n);
                            progress(base.saturating_add(n), 0);
                        },
                    )
                    .await?;
                    bytes = bytes.saturating_add(done.get());
                    created.push((path, false));
                }
            }
        }
        for (path, modified) in checked {
            checkpoint()?;
            let attrs = remotes.stat(src.0, src.1, &path).await?;
            if attrs.kind() != 0o040000 || attrs.modified != Some(modified) {
                return Err("A source folder changed while copying.".into());
            }
        }
        checkpoint()?;
        remote_rename(&session, &payload, &target).await?;
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
        return Err(if clean {
            error
        } else {
            format!("{error} Check {stage} and {target} for the copy's outcome.")
        });
    }
    let _ = remote_remove(&session, &stage, true).await;
    Ok(target)
}
