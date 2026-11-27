// Track exactly what was copied before removing a staged remote source.
use super::Remotes;
use crate::services::remotes::{
    browse,
    wire::{Fields, Reply, Request},
    Session,
};
use std::{collections::BTreeMap, sync::Arc};

#[derive(Clone, Debug, PartialEq, Eq)]
struct Stamp {
    kind: u32,
    size: Option<u64>,
    modified: u64,
}
type Snapshot = BTreeMap<String, Stamp>;

fn stamp(attrs: &crate::services::remotes::wire::Attrs) -> Result<Stamp, String> {
    let kind = attrs.kind();
    if !matches!(kind, 0o100000 | 0o040000) {
        return Err("The source contains a link or special file.".into());
    }
    if kind == 0o100000 && attrs.size.is_none() {
        return Err("The server did not provide a file size.".into());
    }
    Ok(Stamp {
        kind,
        size: attrs.size,
        modified: attrs
            .modified
            .ok_or("The server did not provide a modification time.")?,
    })
}

async fn snapshot(
    remotes: &Remotes,
    profile: &str,
    session: u32,
    root: &str,
    checkpoint: &mut dyn FnMut() -> Result<(), String>,
) -> Result<Snapshot, String> {
    let mut found = Snapshot::new();
    let mut pending = vec![(root.to_owned(), 0usize)];
    while let Some((path, depth)) = pending.pop() {
        checkpoint()?;
        if depth > 64 || found.len() >= 100_000 {
            return Err("The source folder is too large or deeply nested.".into());
        }
        let attrs = remotes.stat(profile, session, &path).await?;
        let value = stamp(&attrs)?;
        if value.kind == 0o040000 {
            let listing = remotes.list(profile, &path, Some(session)).await?;
            if listing.path != path || listing.omitted_entries != 0 {
                return Err("A source folder changed or contains unsupported names.".into());
            }
            for entry in listing.entries {
                pending.push((entry.path, depth + 1));
            }
        }
        found.insert(path, value);
    }
    Ok(found)
}

pub(super) struct CopiedSource(Snapshot);
impl CopiedSource {
    pub async fn capture(
        remotes: &Remotes,
        profile: &str,
        session: u32,
        root: &str,
        checkpoint: &mut dyn FnMut() -> Result<(), String>,
    ) -> Result<Self, String> {
        snapshot(remotes, profile, session, root, checkpoint)
            .await
            .map(Self)
    }

    pub async fn remove(
        self,
        remotes: &Remotes,
        profile: &str,
        id: u32,
        root: &str,
        session: &Arc<Session>,
    ) -> Result<(), String> {
        // Once the copy is published, finish cleanup without pausing halfway.
        if snapshot(remotes, profile, id, root, &mut || Ok(())).await? != self.0 {
            return Err("The source changed while it was being copied.".into());
        }
        let mut paths: Vec<_> = self.0.into_iter().collect();
        paths.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        for (path, expected) in paths {
            let parent = path
                .rsplit_once('/')
                .map(|(p, _)| if p.is_empty() { "/" } else { p })
                .ok_or("Invalid source path.")?;
            let mut wire = session.wire.lock().await;
            session
                .complete(
                    async {
                        if browse::canonical(&mut wire, parent).await? != parent {
                            return Err(crate::services::remotes::wire::Error::Request(
                                "A source folder changed.".into(),
                            ));
                        }
                        let packet = wire
                            .path_request(Request::Lstat, path.as_bytes(), Reply::Attrs)
                            .await?;
                        let current = Fields(&packet).attrs()?;
                        // Removing children changes directory times, so only files can
                        // be compared again after deletion starts. Rmdir refuses new children.
                        if current.kind() != expected.kind
                            || (expected.kind == 0o100000
                                && stamp(&current).ok().as_ref() != Some(&expected))
                        {
                            return Err(crate::services::remotes::wire::Error::Request(
                                "The source changed; remaining items were kept.".into(),
                            ));
                        }
                        wire.path_request(
                            if expected.kind == 0o040000 {
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
                .await?;
        }
        Ok(())
    }
}
