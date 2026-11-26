// Bounded, positional reads on the shared SFTP connection.
use super::wire::{put_string, Error, Fields, Reply, Request, Result, Wire};

pub(crate) const MAX_READ: usize = 1024 * 1024;
const CHUNK: usize = 64 * 1024;

pub(crate) struct FileRange {
    pub size: u64,
    pub modified: Option<u64>,
    pub bytes: Vec<u8>,
}

pub(super) async fn read_range(
    wire: &mut Wire,
    path: &str,
    offset: u64,
    length: usize,
) -> Result<FileRange> {
    if length > MAX_READ || offset.checked_add(length as u64).is_none() {
        return Err(Error::Request(
            "Remote read exceeds the allowed range.".into(),
        ));
    }
    // Exclude symlinks and non-regular entries before opening.
    let packet = wire
        .path_request(Request::Lstat, path.as_bytes(), Reply::Attrs)
        .await?;
    if Fields(&packet).attrs()?.kind() != 0o100000 {
        return Err(Error::Request(
            "The remote path is not a regular file.".into(),
        ));
    }
    let mut payload = Vec::new();
    put_string(&mut payload, path.as_bytes());
    payload.extend_from_slice(&1u32.to_be_bytes());
    payload.extend_from_slice(&0u32.to_be_bytes());
    let packet = wire.request(Request::Open, &payload, Reply::Handle).await?;
    let handle = Fields(&packet).string()?.to_vec();
    let result = async {
        let packet = wire
            .path_request(Request::Fstat, &handle, Reply::Attrs)
            .await?;
        let attrs = Fields(&packet).attrs()?;
        let size = attrs
            .size
            .ok_or_else(|| Error::Request("The server did not provide the file size.".into()))?;
        if attrs.kind() != 0o100000 {
            return Err(Error::Request(
                "The remote path is not a regular file.".into(),
            ));
        }
        let target = (size.saturating_sub(offset)).min(length as u64) as usize;
        let mut bytes = Vec::with_capacity(target);
        while bytes.len() < target {
            let count = (target - bytes.len()).min(CHUNK);
            let mut payload = Vec::new();
            put_string(&mut payload, &handle);
            payload.extend_from_slice(&(offset + bytes.len() as u64).to_be_bytes());
            payload.extend_from_slice(&(count as u32).to_be_bytes());
            let packet = match wire.request(Request::Read, &payload, Reply::Data).await {
                Ok(packet) => packet,
                Err(Error::Eof) => {
                    return Err(Error::Request(
                        "The remote file changed during reading.".into(),
                    ))
                }
                Err(error) => return Err(error),
            };
            let data = Fields(&packet).string()?;
            if data.is_empty() || data.len() > count {
                return Err(Error::Transport("Invalid SFTP file data.".into()));
            }
            bytes.extend_from_slice(data);
        }
        Ok(FileRange {
            size,
            modified: attrs.modified,
            bytes,
        })
    }
    .await;
    if !matches!(result, Err(Error::Transport(_))) {
        wire.close(&handle).await?;
    }
    result
}
