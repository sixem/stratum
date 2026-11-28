// Direct SFTP moves and Download & open run outside the transfer queue.
use crate::services::operation_events::{
    EntryKind, ItemSuccess, Location, OperationEvents, Origin, TransferCounts, TransferOutcome,
};
use std::path::Path;

pub(super) enum DirectTransfer<'a> {
    Downloaded(&'a Path),
    Moved(&'a str),
    Cancelled,
    Failed,
}

pub(super) fn finish(
    events: &OperationEvents,
    id: Option<&str>,
    profile: &str,
    path: &str,
    kind: EntryKind,
    result: DirectTransfer<'_>,
) {
    if !events.has_subscribers() {
        return;
    }
    let source = Location::sftp(profile, path);
    let mut report = events.operation(id, Origin::User, [source.clone()]);
    let mut counts = TransferCounts::default();
    let outcome = match result {
        DirectTransfer::Downloaded(target) => {
            report.item_succeeded(&source, kind, || ItemSuccess::Copied {
                destination: Location::Local(target.to_owned()),
            });
            counts.copied = 1;
            TransferOutcome::Completed
        }
        DirectTransfer::Moved(target) => {
            report.item_succeeded(&source, kind, || ItemSuccess::Relocated {
                destination: Location::sftp(profile, target),
            });
            counts.moved = 1;
            TransferOutcome::Completed
        }
        DirectTransfer::Cancelled => TransferOutcome::Cancelled,
        DirectTransfer::Failed => {
            counts.failed = 1;
            TransferOutcome::Failed
        }
    };
    report.finish_transfer(outcome, counts);
}
