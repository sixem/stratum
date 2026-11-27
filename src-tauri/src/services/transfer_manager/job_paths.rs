// Track the roots a job may read or change. Overlapping operations run in
// arrival order, while unrelated files can share the same destination folder.
use super::manager_state::TransferOperation;
use crate::domain::filesystem::transfer::{normalize_path_key, same_path};
use std::fs;
use std::path::{self, Path, PathBuf, MAIN_SEPARATOR};

pub(super) struct TransferJobPaths {
    // Trailing separators make an ancestor a prefix of each descendant and
    // keep siblings such as "data" and "database" distinct.
    paths: Vec<String>,
    unresolved: bool,
}

impl TransferJobPaths {
    pub(super) fn from_operation(operation: &TransferOperation) -> Self {
        let mut claims = Self {
            paths: Vec::new(),
            unresolved: false,
        };
        match operation {
            #[cfg(windows)]
            TransferOperation::RemoteDelete(job) => claims.add_remote(&job.profile, &job.parent),
            #[cfg(windows)]
            TransferOperation::RemoteBatch(batch) => {
                for job in &batch.items {
                    let part = Self::from_operation(&TransferOperation::Remote(job.clone()));
                    claims.paths.extend(part.paths);
                    claims.unresolved |= part.unresolved;
                }
            }
            #[cfg(windows)]
            TransferOperation::Remote(job) => {
                use crate::services::remotes::transfer::Direction;
                match &job.direction {
                    Direction::Download {
                        remote_path,
                        local_folder,
                    } => {
                        claims.add_remote(&job.profile, remote_path);
                        match remote_path
                            .rsplit('/')
                            .next()
                            .filter(|name| !name.is_empty())
                        {
                            Some(name) => claims.add_path(&local_folder.join(name)),
                            None => claims.unresolved = true,
                        }
                    }
                    Direction::Upload {
                        local_path,
                        remote_folder,
                    } => {
                        claims.add_path(local_path);
                        match local_path.file_name().and_then(|name| name.to_str()) {
                            Some(name) if !name.is_empty() => claims.add_remote(
                                &job.profile,
                                &format!("{}/{name}", remote_folder.trim_end_matches('/')),
                            ),
                            _ => claims.unresolved = true,
                        }
                    }
                    Direction::Remote {
                        remote_path,
                        dest_profile,
                        remote_folder,
                        ..
                    } => {
                        claims.add_remote(&job.profile, remote_path);
                        match remote_path
                            .rsplit('/')
                            .next()
                            .filter(|name| !name.is_empty())
                        {
                            Some(name) => claims.add_remote(
                                dest_profile,
                                &format!("{}/{name}", remote_folder.trim_end_matches('/')),
                            ),
                            None => claims.unresolved = true,
                        }
                    }
                    Direction::Rename {
                        parent,
                        destination,
                        ..
                    } => {
                        claims.add_remote(&job.profile, parent);
                        claims.add_remote(&job.profile, destination);
                    }
                }
            }
            TransferOperation::Copy {
                paths, destination, ..
            }
            | TransferOperation::Transfer {
                paths, destination, ..
            } => {
                let target = Path::new(destination.trim());
                for raw in paths {
                    let source = Path::new(raw.trim());
                    claims.add_path(source);
                    let Some(name) = source.file_name() else {
                        continue;
                    };
                    // Duplicating into the source folder picks a free suffixed
                    // name at execution time, so reserve the containing folder.
                    if matches!(operation, TransferOperation::Copy { .. })
                        && source
                            .parent()
                            .is_some_and(|parent| same_path(parent, target))
                    {
                        claims.add_path(target);
                    } else {
                        claims.add_path(&target.join(name));
                    }
                }
            }
            TransferOperation::Delete { paths } | TransferOperation::Trash { paths } => {
                for path in paths {
                    claims.add_path(Path::new(path));
                }
            }
            TransferOperation::Conversion { items } => {
                for item in items {
                    claims.add_path(Path::new(item.source_path().trim()));
                    claims.add_path(Path::new(item.destination_path().trim()));
                }
            }
        }
        claims.paths.sort_unstable();
        claims.paths.dedup();
        claims
    }

    #[cfg(windows)]
    fn add_remote(&mut self, profile: &str, path: &str) {
        if profile.is_empty()
            || profile.contains('\0')
            || !path.starts_with('/')
            || path.contains('\0')
            || path.split('/').any(|part| part == "." || part == "..")
        {
            self.unresolved = true;
            return;
        }
        // Remote aliases and symlinks can name the same directory. Reserve the
        // host as a whole until the scheduler can resolve those aliases safely.
        self.paths
            .push(format!("\0remote:{}:{profile}/", profile.len()));
    }

    fn add_path(&mut self, path: &Path) {
        if path.as_os_str().is_empty() {
            return;
        }
        let Ok(absolute) = path::absolute(path) else {
            self.unresolved = true;
            return;
        };
        self.paths.push(scheduling_key(&absolute));
        // Keep both names. For example, a move through a junction must wait
        // for a move of the junction itself or work on the real target.
        if let Some(resolved) = resolve_existing_ancestor(&absolute) {
            self.paths.push(scheduling_key(&resolved));
        } else {
            self.unresolved = true;
        }
    }

    pub(super) fn overlaps(&self, other: &Self) -> bool {
        if self.unresolved || other.unresolved {
            return true;
        }
        let mut left = self.paths.iter().peekable();
        let mut right = other.paths.iter().peekable();
        while let (Some(a), Some(b)) = (left.peek(), right.peek()) {
            if a.starts_with(b.as_str()) || b.starts_with(a.as_str()) {
                return true;
            }
            if a < b {
                left.next();
            } else {
                right.next();
            }
        }
        false
    }
}

fn scheduling_key(path: &Path) -> String {
    let mut key = normalize_path_key(path);
    if !key.ends_with(MAIN_SEPARATOR) {
        key.push(MAIN_SEPARATOR);
    }
    key
}

fn resolve_existing_ancestor(path: &Path) -> Option<PathBuf> {
    // The destination usually does not exist yet. Resolve its containing
    // directory (including junctions) and attach the remaining names.
    for ancestor in path.ancestors() {
        match fs::canonicalize(ancestor) {
            Ok(resolved) => {
                let remainder = path.strip_prefix(ancestor).ok()?;
                return Some(if remainder.as_os_str().is_empty() {
                    resolved
                } else {
                    resolved.join(remainder)
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return None,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy(source: &Path, target: &Path) -> TransferJobPaths {
        TransferJobPaths::from_operation(&TransferOperation::Copy {
            paths: vec![source.to_string_lossy().into_owned()],
            destination: target.to_string_lossy().into_owned(),
            options: None,
        })
    }

    fn delete(path: &Path) -> TransferJobPaths {
        TransferJobPaths::from_operation(&TransferOperation::Delete {
            paths: vec![path.to_string_lossy().into_owned()],
        })
    }

    #[cfg(windows)]
    #[test]
    fn remote_jobs_reserve_the_host_and_their_local_file() {
        use crate::services::remotes::{
            transfer::{Direction, Transfer},
            Remotes,
        };
        let root = std::env::temp_dir().join("stratum-remote-claims");
        let download = |profile: &str, remote: &str, folder: &Path| {
            TransferJobPaths::from_operation(&TransferOperation::Remote(Transfer {
                remotes: Remotes::default(),
                profile: profile.into(),
                session: 1,
                replace: false,
                moving: false,
                recovery: None,
                expected: None,
                source_changed: None,
                direction: Direction::Download {
                    remote_path: remote.into(),
                    local_folder: folder.into(),
                },
            }))
        };
        let first = download("host-a", "/one/file.txt", &root.join("downloads"));
        let same_host = download("host-a", "/elsewhere/other.txt", &root.join("other"));
        let other_host = download("host-b", "/other/different.txt", &root.join("other"));
        assert!(first.overlaps(&same_host));
        assert!(!first.overlaps(&other_host));
        assert!(first.overlaps(&delete(&root.join("downloads"))));
    }

    #[test]
    fn move_can_share_a_destination_folder_with_an_active_copy() {
        let root = std::env::temp_dir().join("stratum-job-paths");
        let source = root.join("source");
        let target = root.join("target");
        let active = copy(&source.join("large.bin"), &target);
        let sibling = TransferJobPaths::from_operation(&TransferOperation::Transfer {
            paths: vec![source.join("small.txt").to_string_lossy().into_owned()],
            destination: target.to_string_lossy().into_owned(),
            options: Some(crate::domain::filesystem::TransferOptions {
                mode: Some(crate::domain::filesystem::TransferMode::Move),
                ..Default::default()
            }),
            #[cfg(windows)]
            drop_stage: None,
        });
        assert!(!active.overlaps(&sibling));

        let same_name = copy(&root.join("other-source").join("large.bin"), &target);
        assert!(active.overlaps(&same_name));
        assert!(active.overlaps(&delete(&source)));
        assert!(active.overlaps(&delete(&target)));
        assert!(!active.overlaps(&delete(&root.join("target-backup"))));
    }

    #[test]
    fn duplication_reserves_the_folder_for_dynamic_names() {
        let root = std::env::temp_dir().join("stratum-job-paths");
        let target = root.join("target");
        let duplicate = copy(&target.join("original.txt"), &target);
        assert!(duplicate.overlaps(&delete(&target.join("original (1).txt"))));
    }

    #[cfg(windows)]
    #[test]
    fn windows_path_spelling_does_not_bypass_a_reservation() {
        let temp = std::env::temp_dir();
        let path = temp.join("stratum-job-paths").join("photo.png");
        let differently_spelled = path.to_string_lossy().replace('\\', "/").to_uppercase();
        assert!(delete(&path).overlaps(&delete(Path::new(&differently_spelled))));

        let extended = fs::canonicalize(temp)
            .unwrap()
            .join("stratum-job-paths")
            .join("photo.png");
        assert!(delete(&path).overlaps(&delete(&extended)));
    }
}
