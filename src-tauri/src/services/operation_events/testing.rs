// Assertions for producers exercising the real in-memory stream.
use super::*;
use tokio::sync::broadcast::{error::TryRecvError, Receiver};

pub(crate) struct Observed(Receiver<Arc<OperationEvent>>);

impl Observed {
    pub(crate) fn subscribe(events: &OperationEvents) -> Self {
        Self(events.subscribe())
    }

    pub(crate) fn item(&mut self, id: Option<&str>, kind: EntryKind, change: ItemChange) {
        let event = self.0.try_recv().expect("missing item event");
        if let Some(id) = id {
            assert_eq!(event.operation_id, id);
        }
        assert_eq!(event.origin, Origin::User);
        assert!(
            matches!(&event.details, EventDetails::Item { kind: actual, change: payload } if *actual == kind && *payload == change),
            "{event:?}"
        );
    }

    pub(crate) fn terminal(&mut self, id: &str, outcome: TransferOutcome, counts: TransferCounts) {
        let event = self.0.try_recv().expect("missing terminal event");
        assert_eq!(event.operation_id, id);
        assert!(
            matches!(event.details, EventDetails::Transfer { outcome: actual, counts: totals } if actual == outcome && totals == counts),
            "{event:?}"
        );
        self.empty();
    }

    pub(crate) fn empty(&mut self) {
        assert_eq!(self.0.try_recv().unwrap_err(), TryRecvError::Empty);
    }
}
