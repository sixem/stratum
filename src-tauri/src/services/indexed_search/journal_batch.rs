// The cursor is exclusive. Each batch contains the ordered structural records
// from the previous checkpoint up to (but excluding) the next checkpoint.
use super::catalog::JournalCheckpoint;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum JournalChangeKind {
    Path,
    RenameOld(u64),
    RenameNew(u64),
}

#[derive(Debug)]
pub(super) struct JournalPathChange {
    pub(super) path: String,
    pub(super) parent_file_id: u64,
    pub(super) kind: JournalChangeKind,
}

#[derive(Debug)]
pub(super) struct JournalBatch {
    pub(super) changes: Vec<JournalPathChange>,
    pub(super) previous: JournalCheckpoint,
    pub(super) next: JournalCheckpoint,
    pub(super) has_more: bool,
}
