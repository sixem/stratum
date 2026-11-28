// Confirmed outcomes use the final paths supplied by the operation. No filesystem
// queries are needed after a source has moved or disappeared.
use crate::domain::filesystem::transfer::same_path;
pub(crate) use crate::domain::filesystem::transfer::EntryKind;
use std::{
    path::PathBuf,
    time::{Instant, SystemTime},
};
use uuid::Uuid;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) enum Location {
    Local(PathBuf),
    Sftp { host_id: String, path: String },
}

impl Location {
    pub(crate) fn sftp(host_id: &str, path: impl Into<String>) -> Self {
        Self::Sftp {
            host_id: host_id.to_owned(),
            path: path.into(),
        }
    }

    // Producers supply resolved parents, retaining the exact name of the selected entry.
    fn relocation(self, destination: Self) -> Option<ItemChange> {
        let (same_parent, same_name) = match (&self, &destination) {
            (Self::Local(a), Self::Local(b)) => (
                a.parent()
                    .zip(b.parent())
                    .is_some_and(|(a, b)| same_path(a, b)),
                a.file_name() == b.file_name(),
            ),
            (
                Self::Sftp {
                    host_id: a,
                    path: from,
                },
                Self::Sftp {
                    host_id: b,
                    path: to,
                },
            ) => {
                // A backslash is a legal character in a remote name, even on a Windows client.
                let (old_parent, old_name) = from.rsplit_once('/')?;
                let (new_parent, new_name) = to.rsplit_once('/')?;
                (a == b && old_parent == new_parent, old_name == new_name)
            }
            _ => (false, false),
        };
        if same_parent && same_name {
            return None;
        }
        Some(if same_parent {
            ItemChange::Renamed {
                source: self,
                destination,
            }
        } else {
            ItemChange::Moved {
                source: self,
                destination,
            }
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Origin {
    User,
    Rule,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DeleteMethod {
    Permanent,
    RecycleBin,
}

// One committed result per selected root. A copy/move has no separate creation result.
pub(crate) enum ItemSuccess {
    Created { destination: Location },
    Copied { destination: Location },
    Relocated { destination: Location },
    Deleted(DeleteMethod),
}

impl ItemSuccess {
    pub(super) fn change(self, root: Location) -> Option<ItemChange> {
        Some(match self {
            Self::Created { destination } => ItemChange::Created { destination },
            Self::Copied { destination } => ItemChange::Copied {
                source: root,
                destination,
            },
            Self::Relocated { destination } => return root.relocation(destination),
            Self::Deleted(DeleteMethod::RecycleBin) if matches!(root, Location::Sftp { .. }) => {
                return None
            }
            Self::Deleted(method) => ItemChange::Deleted {
                source: root,
                method,
            },
        })
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum ItemChange {
    Created {
        destination: Location,
    },
    Copied {
        source: Location,
        destination: Location,
    },
    Moved {
        source: Location,
        destination: Location,
    },
    Renamed {
        source: Location,
        destination: Location,
    },
    Deleted {
        source: Location,
        method: DeleteMethod,
    },
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct TransferCounts {
    pub copied: usize,
    pub moved: usize,
    pub skipped: usize,
    pub failed: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TransferOutcome {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug)]
pub(crate) enum EventDetails {
    Item {
        kind: EntryKind,
        change: ItemChange,
    },
    Transfer {
        outcome: TransferOutcome,
        counts: TransferCounts,
    },
}

#[derive(Debug)]
pub(crate) struct OperationEvent {
    pub id: Uuid,
    pub operation_id: String,
    pub timestamp: SystemTime,
    // Subscription changes compare process-local time even if the system clock is adjusted.
    pub emitted_at: Instant,
    pub origin: Origin,
    pub details: EventDetails,
}

impl OperationEvent {
    pub(crate) fn name(&self) -> &'static str {
        use EntryKind::{Directory, File};
        use ItemChange::*;
        match &self.details {
            EventDetails::Item { kind, change } => match (kind, change) {
                (File, Created { .. }) => "file.created",
                (Directory, Created { .. }) => "directory.created",
                (File, Copied { .. }) => "file.copied",
                (Directory, Copied { .. }) => "directory.copied",
                (File, Moved { .. }) => "file.moved",
                (Directory, Moved { .. }) => "directory.moved",
                (File, Renamed { .. }) => "file.renamed",
                (Directory, Renamed { .. }) => "directory.renamed",
                (File, Deleted { .. }) => "file.deleted",
                (Directory, Deleted { .. }) => "directory.deleted",
            },
            EventDetails::Transfer { outcome, .. } => match outcome {
                TransferOutcome::Completed => "transfer.completed",
                TransferOutcome::Failed => "transfer.failed",
                TransferOutcome::Cancelled => "transfer.cancelled",
            },
        }
    }
}
