// Use absolute POSIX paths on every request. Tabs share the stream, never a working directory.
use super::wire::{Error, Fields, Reply, Request, Result, Wire};
use serde::Serialize;

const MAX_ENTRIES: usize = 100_000;
const MAX_LIST_BYTES: usize = 24 * 1024 * 1024;
pub(super) fn check_path(path: &str, allow_relative: bool) -> Result<()> {
    if path.len() > 8192 || path.contains('\0') || (!allow_relative && !path.starts_with('/')) {
        return Err(Error::Request("The remote path is invalid.".into()));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    pub(super) name: String,
    pub(super) path: String,
    pub(super) is_dir: bool,
    pub(super) is_symlink: bool,
    pub(super) size: Option<u64>,
    pub(super) modified: Option<u64>,
}

pub(super) async fn canonical(wire: &mut Wire, path: &str) -> Result<String> {
    let packet = wire
        .path_request(Request::Realpath, path.as_bytes(), Reply::Name)
        .await?;
    let mut fields = Fields(&packet);
    if fields.number()? != 1 {
        return Err(Error::Transport("Invalid canonical SFTP path.".into()));
    }
    let value = std::str::from_utf8(fields.string()?)
        .map_err(|_| Error::Request("Remote path is not UTF-8.".into()))?;
    check_path(value, false)?;
    Ok(value.to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkTarget {
    pub kind: &'static str,
    pub path: String,
}

pub(super) async fn link_target(wire: &mut Wire, path: &str) -> Result<LinkTarget> {
    let packet = wire
        .path_request(Request::Lstat, path.as_bytes(), Reply::Attrs)
        .await?;
    if Fields(&packet).attrs()?.kind() != 0o120000 {
        return Err(Error::Request(
            "The remote entry is no longer a symbolic link.".into(),
        ));
    }
    resolve_target(wire, path).await
}

// Breadcrumbs can traverse links in any component of the displayed path.
pub(super) async fn resolve_target(wire: &mut Wire, path: &str) -> Result<LinkTarget> {
    let target = canonical(wire, path).await?;
    let packet = wire
        .path_request(Request::Stat, target.as_bytes(), Reply::Attrs)
        .await?;
    let kind = match Fields(&packet).attrs()?.kind() {
        0o040000 => "directory",
        0o100000 => "file",
        _ => {
            return Err(Error::Request(
                "The target is not a regular file or folder.".into(),
            ))
        }
    };
    Ok(LinkTarget { kind, path: target })
}

pub(super) async fn read_directory(
    wire: &mut Wire,
    path: &str,
    probe_only: bool,
) -> Result<(String, Vec<Entry>, usize)> {
    read_directory_controlled(wire, path, probe_only, &mut || Ok(())).await
}

// Check cancellation between SFTP packets and still close the directory handle.
pub(super) async fn read_directory_controlled(
    wire: &mut Wire,
    path: &str,
    probe_only: bool,
    checkpoint: &mut (dyn FnMut() -> Result<()> + Send),
) -> Result<(String, Vec<Entry>, usize)> {
    checkpoint()?;
    let path = canonical(wire, if path.is_empty() { "." } else { path }).await?;
    let packet = wire
        .path_request(Request::OpenDir, path.as_bytes(), Reply::Handle)
        .await?;
    let handle = Fields(&packet).string()?.to_vec();
    let result = async {
        let mut entries = Vec::new();
        let mut omitted = 0;
        let mut bytes = 0;
        loop {
            checkpoint()?;
            let packet = match wire
                .path_request(Request::ReadDir, &handle, Reply::Name)
                .await
            {
                Ok(packet) => packet,
                Err(Error::Eof) => break,
                Err(err) => return Err(err),
            };
            let mut fields = Fields(&packet);
            let count = fields.number()? as usize;
            if count == 0 {
                return Err(Error::Transport(
                    "The server returned an empty SFTP listing packet.".into(),
                ));
            }
            if probe_only {
                break;
            }
            if entries.len() + omitted + count > MAX_ENTRIES {
                return Err(Error::Request(
                    "This remote directory exceeds the listing limit.".into(),
                ));
            }
            for _ in 0..count {
                let raw = fields.string()?;
                fields.string()?; // Long-form display name is deliberately unused.
                let attrs = fields.attrs()?;
                if raw == b"." || raw == b".." {
                    continue;
                }
                let Ok(name) = std::str::from_utf8(raw) else {
                    omitted += 1;
                    continue;
                };
                if name.is_empty() || name.contains(['/', '\0']) {
                    omitted += 1;
                    continue;
                }
                let full_path = format!("{}/{name}", path.trim_end_matches('/'));
                if full_path.len() > 8192 {
                    omitted += 1;
                    continue;
                }
                bytes += name.len() + full_path.len();
                if bytes > MAX_LIST_BYTES {
                    return Err(Error::Request(
                        "This remote directory exceeds the listing limit.".into(),
                    ));
                }
                entries.push(Entry {
                    name: name.into(),
                    path: full_path,
                    is_dir: attrs.kind() == 0o040000,
                    is_symlink: attrs.kind() == 0o120000,
                    size: attrs.size,
                    modified: attrs.modified,
                });
            }
        }
        Ok((path, entries, omitted))
    }
    .await;
    if !matches!(result, Err(Error::Transport(_))) {
        wire.close(&handle).await?;
    }
    result
}
