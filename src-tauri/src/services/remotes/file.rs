// Bounded, positional reads on the shared SFTP connection.
use super::wire::{put_string, Attrs, Error, Fields, Reply, Request, Result, Wire};

pub(crate) const MAX_READ: usize = 1024 * 1024;
pub(super) const CHUNK: usize = 64 * 1024;
pub(super) const WINDOW_BYTES: usize = super::wire::MAX_IN_FLIGHT * CHUNK;

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
    let handle = open_regular(wire, path).await?;
    let result = async {
        let (size, modified) = metadata(wire, &handle).await?;
        let target = size.saturating_sub(offset).min(length as u64) as usize;
        let mut bytes = Vec::with_capacity(target);
        while bytes.len() < target {
            let count = (target - bytes.len()).min(WINDOW_BYTES);
            bytes.extend(read_window(wire, &handle, offset + bytes.len() as u64, count).await?);
        }
        Ok(FileRange {
            size,
            modified,
            bytes,
        })
    }
    .await;
    if !matches!(result, Err(Error::Transport(_))) {
        wire.close(&handle).await?;
    }
    result
}

pub(super) async fn open_regular(wire: &mut Wire, path: &str) -> Result<Vec<u8>> {
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
    Ok(Fields(&packet).string()?.to_vec())
}

pub(super) async fn metadata(wire: &mut Wire, handle: &[u8]) -> Result<(u64, Option<u64>)> {
    let packet = wire
        .path_request(Request::Fstat, handle, Reply::Attrs)
        .await?;
    let attrs: Attrs = Fields(&packet).attrs()?;
    if attrs.kind() != 0o100000 {
        return Err(Error::Request(
            "The remote path is not a regular file.".into(),
        ));
    }
    let size = attrs
        .size
        .ok_or_else(|| Error::Request("The server did not provide the file size.".into()))?;
    Ok((size, attrs.modified))
}

pub(super) async fn read_window(
    wire: &mut Wire,
    handle: &[u8],
    offset: u64,
    length: usize,
) -> Result<Vec<u8>> {
    let mut bytes = vec![0; length];
    let mut ranges: Vec<_> = (0..length)
        .step_by(CHUNK)
        .map(|start| start..length.min(start + CHUNK))
        .collect();
    // A server may return a short DATA packet. Reissue only the missing tails.
    while !ranges.is_empty() {
        let requests = ranges
            .iter()
            .map(|range| {
                let mut payload = Vec::new();
                put_string(&mut payload, handle);
                payload.extend_from_slice(&(offset + range.start as u64).to_be_bytes());
                payload.extend_from_slice(&(range.len() as u32).to_be_bytes());
                payload
            })
            .collect::<Vec<_>>();
        let replies = wire
            .window(Request::Read, &requests, Reply::Data)
            .await
            .map_err(|e| match e {
                Error::Eof => Error::Request("The remote file changed during reading.".into()),
                other => other,
            })?;
        for (range, reply) in ranges.iter_mut().zip(replies) {
            let data = Fields(&reply).string()?;
            if data.is_empty() || data.len() > range.len() {
                return Err(Error::Transport("Invalid SFTP file data.".into()));
            }
            let end = range.start + data.len();
            bytes[range.start..end].copy_from_slice(data);
            range.start = end;
        }
        ranges.retain(|range| !range.is_empty());
    }
    Ok(bytes)
}
