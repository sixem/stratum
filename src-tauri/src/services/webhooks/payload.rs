// The receiver contract is versioned independently of the internal event model.
use crate::services::operation_events::{
    DeleteMethod, EventDetails, ItemChange, Location, OperationEvent, Origin,
};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub(super) const EVENT_TYPES: &[&str] = &[
    "file.created",
    "file.copied",
    "file.moved",
    "file.renamed",
    "file.deleted",
    "directory.created",
    "directory.copied",
    "directory.moved",
    "directory.renamed",
    "directory.deleted",
    "transfer.completed",
    "transfer.failed",
    "transfer.cancelled",
];

pub(super) fn millis(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn location(value: &Location) -> Value {
    match value {
        Location::Local(path) => json!({"kind":"local", "path":path.to_string_lossy()}),
        Location::Sftp { host_id, path } => json!({"kind":"sftp", "hostId":host_id, "path":path}),
    }
}

pub(super) fn operation(event: &OperationEvent) -> Value {
    let details = match &event.details {
        EventDetails::Item { change, .. } => match change {
            ItemChange::Created { destination } => json!({"destination":location(destination)}),
            ItemChange::Copied {
                source,
                destination,
            }
            | ItemChange::Moved {
                source,
                destination,
            }
            | ItemChange::Renamed {
                source,
                destination,
            } => json!({"source":location(source), "destination":location(destination)}),
            ItemChange::Deleted { source, method } => json!({"source":location(source),
                "method":match method { DeleteMethod::Permanent => "permanent", DeleteMethod::RecycleBin => "recycleBin" }}),
        },
        EventDetails::Transfer { counts, .. } => json!({"counts":{
            "copied":counts.copied, "moved":counts.moved, "skipped":counts.skipped, "failed":counts.failed
        }}),
    };
    json!({"version":1, "eventId":event.id.to_string(), "operationId":event.operation_id,
        "timestampMs":millis(event.timestamp), "type":event.name(),
        "origin":match event.origin { Origin::User => "user", Origin::Rule => "rule" }, "details":details})
}

pub(super) fn test_event(id: &Uuid) -> Value {
    json!({"version":1,"eventId":id.to_string(),"operationId":id.to_string(),
        "timestampMs":millis(SystemTime::now()), "type":"webhook.test", "origin":"user","details":{}})
}
