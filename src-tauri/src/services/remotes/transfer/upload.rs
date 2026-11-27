// Upload into an exclusive temporary file, then publish with SFTP's
// no-replacement rename after the local source has been read successfully.
use super::super::{
    browse::check_path,
    wire::{put_string, Fields, Reply, Request},
    Remotes, Session,
};
use std::{fs, path::Path, sync::Arc};
use tokio::io::AsyncReadExt;

const CHUNK: usize = 64 * 1024;

pub(super) struct UploadStage {
    session: Arc<Session>,
    path: String,
    handle: Option<Vec<u8>>,
}

impl UploadStage {
    pub(super) async fn create(session: Arc<Session>, folder: &str) -> Result<Self, String> {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| "Could not create a temporary upload name.")?;
        let path = format!(
            "{}/.stratum-upload-{:032x}.part",
            folder.trim_end_matches('/'),
            u128::from_le_bytes(random)
        );
        check_path(&path, false).map_err(|error| error.message().to_owned())?;
        let handle = {
            let mut wire = session.wire.lock().await;
            session
                .complete(
                    async {
                        let mut payload = Vec::new();
                        put_string(&mut payload, path.as_bytes());
                        // WRITE | CREAT | EXCL: never open an existing remote file.
                        payload.extend_from_slice(&0x2au32.to_be_bytes());
                        payload.extend_from_slice(&0u32.to_be_bytes());
                        let reply = wire.request(Request::Open, &payload, Reply::Handle).await?;
                        Ok(Fields(&reply).string()?.to_vec())
                    },
                    60,
                )
                .await
                .map_err(|error| format!("{error} Check {path} for an incomplete upload."))?
        };
        Ok(Self {
            session,
            path,
            handle: Some(handle),
        })
    }

    pub(super) async fn write(&self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        let handle = self.handle.as_ref().ok_or("The upload is closed.")?;
        let mut wire = self.session.wire.lock().await;
        self.session
            .complete(
                async {
                    let requests = bytes
                        .chunks(CHUNK)
                        .enumerate()
                        .map(|(index, chunk)| {
                            let mut payload = Vec::with_capacity(handle.len() + chunk.len() + 16);
                            put_string(&mut payload, handle);
                            payload.extend_from_slice(
                                &(offset + (index * CHUNK) as u64).to_be_bytes(),
                            );
                            put_string(&mut payload, chunk);
                            payload
                        })
                        .collect::<Vec<_>>();
                    wire.window(Request::Write, &requests, Reply::Status)
                        .await?;
                    Ok(())
                },
                60,
            )
            .await
    }

    async fn close(&mut self) -> Result<(), String> {
        if let Some(handle) = self.handle.take() {
            let mut wire = self.session.wire.lock().await;
            self.session.complete(wire.close(&handle), 60).await?;
        }
        Ok(())
    }

    pub(super) async fn remove(&mut self) -> Result<(), String> {
        // Even if close fails, try removal on a still-usable connection.
        let _ = self.close().await;
        let mut wire = self.session.wire.lock().await;
        self.session
            .complete(
                async {
                    wire.path_request(Request::Remove, self.path.as_bytes(), Reply::Status)
                        .await?;
                    Ok(())
                },
                60,
            )
            .await
    }

    pub(super) async fn publish(&mut self, target: &str) -> Result<(), String> {
        self.close().await?;
        let mut wire = self.session.wire.lock().await;
        self.session
            .complete(
                async {
                    let mut payload = Vec::new();
                    put_string(&mut payload, self.path.as_bytes());
                    put_string(&mut payload, target.as_bytes());
                    wire.request(Request::Rename, &payload, Reply::Status)
                        .await?;
                    Ok(())
                },
                60,
            )
            .await
    }
}

fn open_source(path: &Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        };
        // Hold the original file without following a reparse point or allowing
        // another process to replace or write it during the upload.
        options
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(FILE_SHARE_READ);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("Could not open the source file: {error}"))?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("Uploading links is not supported.".into());
        }
    }
    if !metadata.is_file() {
        return Err("The source is not a regular file.".into());
    }
    Ok(file)
}

pub(crate) async fn upload_file(
    remotes: &Remotes,
    profile: &str,
    session_id: u32,
    source: &Path,
    folder: &str,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<String, String> {
    let file = open_source(source)?;
    upload_open_file(
        remotes, profile, session_id, source, file, folder, checkpoint, progress,
    )
    .await
}

// A move holds the very same source open until its published copy is complete.
pub(super) async fn upload_open_file(
    remotes: &Remotes,
    profile: &str,
    session_id: u32,
    source: &Path,
    file: fs::File,
    folder: &str,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<String, String> {
    checkpoint()?;
    check_path(folder, false).map_err(|error| error.message().to_owned())?;
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or("The source filename cannot be represented on the remote host.")?;
    let target = format!("{}/{name}", folder.trim_end_matches('/'));
    check_path(&target, false).map_err(|error| error.message().to_owned())?;
    let initial = file.metadata().map_err(|error| error.to_string())?;
    let modified = initial
        .modified()
        .map_err(|error| format!("Could not check the source file: {error}"))?;
    let session = remotes.current(profile, Some(session_id))?;
    let mut stage = UploadStage::create(session, folder).await?;
    let result: Result<(), String> = async {
        let mut file = tokio::fs::File::from_std(file);
        let mut buffer = vec![0u8; CHUNK];
        let mut done = 0u64;
        progress(done, initial.len());
        loop {
            checkpoint()?;
            let count = file
                .read(&mut buffer)
                .await
                .map_err(|error| format!("Could not read the source file: {error}"))?;
            if count == 0 {
                break;
            }
            stage.write(done, &buffer[..count]).await?;
            done += count as u64;
            progress(done, initial.len());
        }
        let final_metadata = file.metadata().await.map_err(|error| error.to_string())?;
        if done != initial.len()
            || final_metadata.len() != initial.len()
            || final_metadata.modified().ok() != Some(modified)
        {
            return Err("The source file changed while uploading.".into());
        }
        checkpoint()?;
        stage.publish(&target).await.map_err(|error| {
            format!("Could not publish the upload. The destination may already exist: {error}")
        })?;
        Ok(())
    }
    .await;
    if let Err(error) = result {
        return match stage.remove().await {
            Ok(()) => Err(error),
            Err(_) => Err(format!(
                "{error} Check {target} and {} for the upload's outcome.",
                stage.path,
            )),
        };
    }
    Ok(target)
}
