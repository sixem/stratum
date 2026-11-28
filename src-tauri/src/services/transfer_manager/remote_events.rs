// Report only the selected root published by an SFTP worker. Temporary stages,
// backup paths and directory-change notifications never enter the event stream.
use super::job_execution::terminal_status_for_error;
use super::manager_state::TransferOperationOutcome;
use crate::domain::filesystem::transfer::types::TransferJobStatus;
use crate::services::operation_events::{
    ItemSuccess, Location, OperationEvents, Origin, TransferCounts, TransferOutcome,
};
use crate::services::remotes::transfer::{Direction, ItemCompletion, Transfer, TransferResult};

pub(super) enum ItemOutcome<'a> {
    Published(&'a TransferResult),
    Skipped,
    Error(&'a str),
}

impl<'a> From<&'a Result<TransferResult, String>> for ItemOutcome<'a> {
    fn from(result: &'a Result<TransferResult, String>) -> Self {
        match result {
            Ok(output) => Self::Published(output),
            Err(error) => Self::Error(error),
        }
    }
}

pub(super) type Settled<'a> = dyn FnMut(&Transfer, usize, ItemOutcome<'_>) + 'a;

fn source(job: &Transfer, index: usize) -> Location {
    match &job.direction {
        Direction::Download { remote_path, .. } | Direction::Remote { remote_path, .. } => {
            Location::sftp(&job.profile, remote_path)
        }
        Direction::Upload { local_path, .. } => Location::Local(local_path.clone()),
        Direction::Rename {
            parent, entries, ..
        } => Location::sftp(
            &job.profile,
            format!("{}/{}", parent.trim_end_matches('/'), entries[index].name),
        ),
    }
}

fn destination(job: &Transfer, result: &TransferResult) -> Location {
    match &job.direction {
        Direction::Download { .. } => Location::Local(result.path.as_str().into()),
        Direction::Remote { dest_profile, .. } => Location::sftp(dest_profile, &result.path),
        Direction::Upload { .. } | Direction::Rename { .. } => {
            Location::sftp(&job.profile, &result.path)
        }
    }
}

pub(super) fn run(
    events: &OperationEvents,
    id: &str,
    jobs: &[Transfer],
    execute: impl FnOnce(&mut Settled<'_>) -> TransferOperationOutcome,
) -> TransferOperationOutcome {
    let selected = jobs.iter().flat_map(|job| {
        let len = match &job.direction {
            Direction::Rename { entries, .. } => entries.len(),
            _ => 1,
        };
        (0..len).map(move |index| source(job, index))
    });
    let mut report = events.operation(Some(id), Origin::User, selected);
    let mut counts = TransferCounts::default();
    let mut cancelled = false;
    let outcome = execute(&mut |job, index, item| {
        let result = match item {
            ItemOutcome::Published(result) => result,
            ItemOutcome::Skipped => {
                counts.skipped += 1;
                return;
            }
            ItemOutcome::Error(error) => {
                if terminal_status_for_error(error) == TransferJobStatus::Cancelled {
                    cancelled = true;
                } else {
                    counts.failed += 1;
                }
                return;
            }
        };
        match result.completion {
            ItemCompletion::Confirmed(kind) => {
                if job.moving {
                    counts.moved += 1;
                } else {
                    counts.copied += 1;
                }
                if events.has_subscribers() {
                    report.item_succeeded(&source(job, index), kind, || {
                        let destination = destination(job, result);
                        if job.moving {
                            ItemSuccess::Relocated { destination }
                        } else {
                            ItemSuccess::Copied { destination }
                        }
                    });
                }
            }
            ItemCompletion::Incomplete => counts.failed += 1,
            ItemCompletion::Cancelled => cancelled = true,
        }
    });
    cancelled |= outcome.terminal_status == TransferJobStatus::Cancelled;
    let terminal = if cancelled {
        TransferOutcome::Cancelled
    } else if counts.failed > 0
        || outcome.result.is_err()
        || outcome.terminal_status == TransferJobStatus::Failed
    {
        TransferOutcome::Failed
    } else {
        TransferOutcome::Completed
    };
    report.finish_transfer(terminal, counts);
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::{
        operation_events::{testing::Observed, EntryKind, ItemChange},
        remotes::{transfer::BatchResult, Remotes},
        transfer_manager::manager_state::TransferOperationResult,
    };

    #[test]
    fn exact_remote_names_and_retained_sources_survive_batch_reporting() {
        let events = OperationEvents::default();
        let mut seen = Observed::subscribe(&events);
        let path = r"/dir/ a\b ";
        let target = r"/elsewhere/ a\b ";
        let job = Transfer {
            remotes: Remotes::default(),
            profile: "profile-A".into(),
            session: 2,
            moving: true,
            direction: Direction::Remote {
                remote_path: path.into(),
                dest_profile: "profile-B".into(),
                dest_session: 3,
                remote_folder: "/elsewhere".into(),
            },
            expected: None,
            recovery: None,
            replace: false,
            source_changed: None,
        };
        for (completion, expected, counts) in [
            (
                ItemCompletion::Confirmed(EntryKind::File),
                TransferOutcome::Completed,
                TransferCounts {
                    moved: 1,
                    ..Default::default()
                },
            ),
            (
                ItemCompletion::Incomplete,
                TransferOutcome::Failed,
                TransferCounts {
                    failed: 1,
                    ..Default::default()
                },
            ),
            (
                ItemCompletion::Cancelled,
                TransferOutcome::Cancelled,
                TransferCounts::default(),
            ),
        ] {
            run(&events, "work", std::slice::from_ref(&job), |settled| {
                let output = TransferResult {
                    path: target.into(),
                    completion,
                    backup: None,
                    warning: None,
                    local_path: None,
                };
                settled(&job, 0, ItemOutcome::Published(&output));
                TransferOperationOutcome {
                    terminal_status: TransferJobStatus::Completed,
                    result: Ok(TransferOperationResult::RemoteBatch(BatchResult {
                        cancelled: false,
                        items: vec![],
                    })),
                }
            });
            if expected == TransferOutcome::Completed {
                seen.item(
                    Some("work"),
                    EntryKind::File,
                    ItemChange::Moved {
                        source: Location::sftp("profile-A", path),
                        destination: Location::sftp("profile-B", target),
                    },
                );
            }
            seen.terminal("work", expected, counts);
        }
    }
}
