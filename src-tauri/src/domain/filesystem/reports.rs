// Filesystem operation outputs and progress payloads.
// These are grouped together so command handlers can import one contract surface.
use serde::Serialize;

use super::transfer::destination::DestinationSummary;
use super::transfer::EntryKind;
use std::path::Path;

// Success and failure describe the selected root. Skips count each conflict
// decision, including individual entries skipped while merging a directory.
pub(crate) enum RootOutcome<'a> {
    Copied(EntryKind, &'a Path),
    Moved(EntryKind, &'a Path),
    Failed,
    Skipped,
}
pub(crate) type RootReporter<'a> = dyn FnMut(&Path, RootOutcome<'_>) + 'a;

// Transfer/reporting types for copy, move, and queue updates.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyReport {
    pub copied: usize,
    pub skipped: usize,
    pub failures: Vec<String>,
    #[serde(skip)]
    pub(crate) destination: DestinationSummary,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CopyConflictKind {
    FileToFile,
    FileToDirectory,
    DirectoryToFile,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyConflict {
    pub source_path: String,
    pub destination_path: String,
    pub kind: CopyConflictKind,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyPlan {
    pub conflicts: Vec<CopyConflict>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedTransferEntry {
    pub source_path: String,
    pub destination_path: String,
    pub identity: Option<super::EntryIdentity>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferReport {
    pub copied: usize,
    pub moved: usize,
    pub skipped: usize,
    pub cancelled: bool,
    pub failures: Vec<String>,
    pub moved_entries: Vec<MovedTransferEntry>,
    #[serde(skip)]
    pub(crate) destination: DestinationSummary,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub id: String,
    pub processed: usize,
    pub total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_text: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub completed_items: Vec<CompletedTransferItem>,
}

// Selected source item whose execution has settled. For copies and failed
// attempts the source still belongs in the directory view.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedTransferItem {
    pub path: String,
    pub source_removed: bool,
}

// Delta reported only after file work succeeds. Byte callbacks describe
// in-flight data, and can report the full size more than once.
#[derive(Clone, Copy, Default)]
pub(crate) struct CompletedFileWork {
    pub files: usize,
    pub bytes: u64,
}

#[derive(Clone, Default)]
pub(crate) struct TransferProgressUpdate {
    pub processed: usize,
    pub total: usize,
    pub current_path: Option<String>,
    pub current_bytes: Option<u64>,
    pub current_total_bytes: Option<u64>,
    pub progress_percent: Option<f64>,
    pub status_text: Option<String>,
    pub rate_text: Option<String>,
    pub completed_item: Option<CompletedTransferItem>,
    pub completed_file_work: Option<CompletedFileWork>,
    // Publish an item boundary before notifying views that the item settled.
    pub flush_snapshot: bool,
}

// Optional per-item progress reporting for copy/transfer commands.
pub(crate) type TransferProgressCallback = dyn FnMut(TransferProgressUpdate);

// Optional cooperative transfer-control checks used by the backend manager.
pub(crate) type TransferControlCallback = dyn FnMut() -> Result<(), String>;

// Delete/trash report types.
#[derive(Clone)]
pub(crate) struct RemovedRoot {
    pub path: String,
    pub kind: EntryKind,
    pub recycled: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    #[serde(skip)]
    pub(crate) removed_roots: Vec<RemovedRoot>,
    pub deleted: usize,
    pub skipped: usize,
    pub cancelled: bool,
    pub failures: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashReport {
    #[serde(skip)]
    pub(crate) removed_roots: Vec<RemovedRoot>,
    pub deleted: usize,
    pub skipped: usize,
    pub cancelled: bool,
    pub failures: Vec<String>,
    pub failed_paths: Vec<String>,
    pub recycle_undo_receipt: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRecycleReport {
    #[serde(skip)]
    pub(crate) restored_roots: Vec<(std::path::PathBuf, std::path::PathBuf, EntryKind)>,
    pub restored_paths: Vec<String>,
    pub failures: Vec<String>,
    pub can_retry: bool,
}
