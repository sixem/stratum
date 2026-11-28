// Process-local operation reporting. Producers report committed selection roots and
// a terminal Work outcome. Progress, directory traversal and refreshes do not publish.
mod local_mutations;
mod model;
#[cfg(test)]
pub(crate) mod testing;
#[cfg(test)]
mod tests;

pub(crate) use model::*;
use std::borrow::Cow;
use std::collections::HashSet;
use std::sync::{Arc, OnceLock};
use std::time::SystemTime;
use tokio::sync::broadcast;
use uuid::Uuid;

// Receivers see future events in send order. A slow receiver gets an explicit
// Lagged count from Tokio. Filesystem workers never wait for a consumer.
const CHANNEL_CAPACITY: usize = 256;

#[derive(Clone, Default)]
pub(crate) struct OperationEvents {
    channel: Arc<OnceLock<broadcast::Sender<Arc<OperationEvent>>>>,
}

impl OperationEvents {
    // Direct mutations have a single selected root. Batch rename passes the
    // same operation ID to each confirmed command.
    pub(crate) fn local_item(
        &self,
        id: Option<&str>,
        path: &std::path::Path,
        kind: EntryKind,
        success: impl FnOnce() -> ItemSuccess,
    ) {
        if !self.has_subscribers() {
            return;
        }
        let root = Location::Local(path.into());
        self.operation(id, Origin::User, std::iter::once_with(|| root.clone()))
            .item_succeeded(&root, kind, success);
    }
    pub(crate) fn sftp_item(
        &self,
        id: Option<&str>,
        host: &str,
        path: &str,
        kind: EntryKind,
        success: impl FnOnce() -> ItemSuccess,
    ) {
        if !self.has_subscribers() {
            return;
        }
        let root = Location::sftp(host, path);
        self.operation(id, Origin::User, std::iter::once_with(|| root.clone()))
            .item_succeeded(&root, kind, success);
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<Arc<OperationEvent>> {
        self.channel
            .get_or_init(|| broadcast::Sender::new(CHANNEL_CAPACITY))
            .subscribe()
    }

    fn active_channel(&self) -> Option<&broadcast::Sender<Arc<OperationEvent>>> {
        self.channel
            .get()
            .filter(|channel| channel.receiver_count() != 0)
    }

    pub(crate) fn has_subscribers(&self) -> bool {
        self.active_channel().is_some()
    }

    // Map the plan's top-level roots to locations lazily. An unobserved job
    // never traverses its selection or duplicates its paths for reporting.
    pub(crate) fn operation<'a, I: IntoIterator<Item = Location>>(
        &'a self,
        work_id: Option<&'a str>,
        origin: Origin,
        selected: I,
    ) -> OperationReport<'a, I::IntoIter> {
        OperationReport {
            events: self,
            id: work_id
                .filter(|id| !id.trim().is_empty())
                .map(Cow::Borrowed),
            origin,
            selected: selected.into_iter(),
            remaining: None,
        }
    }
}

pub(crate) struct OperationReport<'a, I> {
    events: &'a OperationEvents,
    id: Option<Cow<'a, str>>,
    origin: Origin,
    selected: I,
    remaining: Option<HashSet<Location>>,
}

impl<I: Iterator<Item = Location>> OperationReport<'_, I> {
    // Final destinations can be expensive to construct for large selections.
    // Look one up only when an observer exists and this root has yet to succeed.
    pub(crate) fn item_succeeded(
        &mut self,
        root: &Location,
        kind: EntryKind,
        success: impl FnOnce() -> ItemSuccess,
    ) {
        let Some(channel) = self.events.active_channel() else {
            return;
        };
        let remaining = self
            .remaining
            .get_or_insert_with(|| self.selected.by_ref().collect());
        let Some(selected) = remaining.take(root) else {
            return;
        };
        if let Some(change) = success().change(selected) {
            self.send(channel, EventDetails::Item { kind, change });
        }
    }

    // Consuming the report enforces a single terminal event after its item events.
    pub(crate) fn finish_transfer(mut self, outcome: TransferOutcome, counts: TransferCounts) {
        if let Some(channel) = self.events.active_channel() {
            self.send(channel, EventDetails::Transfer { outcome, counts });
        }
    }

    fn send(&mut self, channel: &broadcast::Sender<Arc<OperationEvent>>, details: EventDetails) {
        let id = self
            .id
            .get_or_insert_with(|| Cow::Owned(Uuid::new_v4().to_string()));
        let event = OperationEvent {
            id: Uuid::new_v4(),
            operation_id: id.to_string(),
            timestamp: SystemTime::now(),
            emitted_at: std::time::Instant::now(),
            origin: self.origin,
            details,
        };
        // The last receiver can disappear between the interest check and this send.
        let _ = channel.send(Arc::new(event));
    }
}
