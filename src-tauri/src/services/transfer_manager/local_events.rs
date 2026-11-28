// Adapt confirmed filesystem results to the event stream. Work and IPC retain
// their existing reports, including errors returned after a partially completed copy.
use super::manager_state::{TransferOperationOutcome, TransferOperationResult};
use crate::domain::filesystem::{self as fs, transfer::types::TransferJobStatus};
use crate::services::operation_events::{
    ItemSuccess, Location, OperationEvents, Origin, TransferCounts, TransferOutcome,
};

pub(super) fn deleted(events: &OperationEvents, id: &str, roots: &[fs::RemovedRoot]) {
    if !events.has_subscribers() {
        return;
    }
    let selected = roots
        .iter()
        .map(|root| Location::Local((&root.path).into()));
    let mut report = events.operation(Some(id), Origin::User, selected);
    for root in roots {
        use crate::services::operation_events::DeleteMethod;
        report.item_succeeded(&Location::Local((&root.path).into()), root.kind, || {
            ItemSuccess::Deleted(if root.recycled {
                DeleteMethod::RecycleBin
            } else {
                DeleteMethod::Permanent
            })
        });
    }
}

pub(super) fn run_transfer(
    events: &OperationEvents,
    id: &str,
    paths: &[String],
    skipped: usize,
    run: impl FnOnce(&mut fs::RootReporter<'_>) -> TransferOperationOutcome,
) -> TransferOperationOutcome {
    let selected = paths.iter().map(|p| Location::Local(p.trim().into()));
    let mut report = events.operation(Some(id), Origin::User, selected);
    let mut counts = TransferCounts {
        skipped,
        ..Default::default()
    };
    let result = run(&mut |source, outcome| {
        let (kind, destination, moved) = match outcome {
            fs::RootOutcome::Copied(kind, path) => {
                counts.copied += 1;
                (kind, path, false)
            }
            fs::RootOutcome::Moved(kind, path) => {
                counts.moved += 1;
                (kind, path, true)
            }
            fs::RootOutcome::Skipped => {
                counts.skipped = counts.skipped.saturating_add(1);
                return;
            }
            fs::RootOutcome::Failed => {
                counts.failed += 1;
                return;
            }
        };
        if events.has_subscribers() {
            report.item_succeeded(&Location::Local(source.into()), kind, || {
                let destination = Location::Local(destination.into());
                if moved {
                    ItemSuccess::Relocated { destination }
                } else {
                    ItemSuccess::Copied { destination }
                }
            });
        }
    });
    let has_errors = match &result.result {
        Ok(TransferOperationResult::Copy(report)) => !report.failures.is_empty(),
        Ok(TransferOperationResult::Transfer(report)) => !report.failures.is_empty(),
        _ => result.result.is_err(),
    };
    let outcome = if result.terminal_status == TransferJobStatus::Cancelled {
        TransferOutcome::Cancelled
    } else if has_errors || counts.failed > 0 {
        TransferOutcome::Failed
    } else {
        TransferOutcome::Completed
    };
    report.finish_transfer(outcome, counts);
    result
}
