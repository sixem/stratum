// Keep incomplete copies on the destination volume until they are ready to publish.
use super::super::common::{remove_path_by_kind, TransferEntryKind};
use super::paths::existing_entry_kind;
use crate::domain::filesystem::staging::{rename_new, StageDirectory};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub(super) struct TransferStage {
    directory: StageDirectory,
    partial_copy: Option<StageDirectory>,
    keep_for_recovery: bool,
}

impl TransferStage {
    pub(super) fn new(destination: &Path) -> Result<Self, String> {
        Ok(Self {
            directory: StageDirectory::beside(destination, "transfer")
                .map_err(|err| err.to_string())?,
            partial_copy: None,
            keep_for_recovery: false,
        })
    }

    pub(super) fn payload(&mut self) -> Result<PathBuf, String> {
        // Claim a fresh private workspace before copying. A direct same-volume
        // rename never owns any partial copy that would need recursive cleanup.
        let workspace = StageDirectory::create(self.directory.path.join("incoming"))
            .map_err(|error| error.to_string())?;
        let payload = workspace.path.join("item");
        self.partial_copy = Some(workspace);
        Ok(payload)
    }

    // Callers finish all cancellable work before this commit. A same-volume
    // move can publish its source directly without copying the tree.
    pub(super) fn publish(
        &mut self,
        prepared: &Path,
        destination: &Path,
        kind: TransferEntryKind,
        existing: Option<TransferEntryKind>,
        cleanup_failures: &mut Vec<String>,
    ) -> io::Result<()> {
        self.publish_item(prepared, destination, kind, existing, cleanup_failures)?;
        self.partial_copy = None;
        Ok(())
    }

    fn publish_item(
        &mut self,
        prepared: &Path,
        destination: &Path,
        kind: TransferEntryKind,
        existing: Option<TransferEntryKind>,
        cleanup_failures: &mut Vec<String>,
    ) -> io::Result<()> {
        let Some(previous_kind) = existing else {
            return rename_new(prepared, destination);
        };
        if !kind.is_directory_like() && !previous_kind.is_directory_like() {
            return fs::rename(prepared, destination);
        }

        // Windows cannot rename over a directory. Keep the complete old item
        // until the second rename succeeds, and roll back a failed publication.
        let previous = self.directory.path.join("previous");
        match rename_new(destination, &previous) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return rename_new(prepared, destination);
            }
            Err(error) => return Err(error),
        }
        if let Err(error) = rename_new(prepared, destination) {
            if let Err(restore) = rename_new(&previous, destination) {
                self.keep_for_recovery = true;
                return Err(io::Error::other(format!(
                    "{error}. Could not restore {} ({restore}). The previous item is at {}",
                    destination.display(),
                    previous.display()
                )));
            }
            return Err(error);
        }
        if let Err(error) = remove_path_by_kind(&previous, previous_kind) {
            self.keep_for_recovery = true;
            cleanup_failures.push(format!(
                "Replaced {}, but could not clean up {}: {error}",
                destination.display(),
                previous.display()
            ));
        }
        Ok(())
    }
}

impl Drop for TransferStage {
    fn drop(&mut self) {
        if let Some(workspace) = self.partial_copy.take() {
            if !self.keep_for_recovery {
                let payload = workspace.path.join("item");
                if let Ok(Some(kind)) = existing_entry_kind(&payload) {
                    let _ = remove_path_by_kind(&payload, kind);
                }
            }
        }
    }
}
