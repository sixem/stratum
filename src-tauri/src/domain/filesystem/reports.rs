// Filesystem operation outputs and progress payloads.
// These are grouped together so command handlers can import one contract surface.
use serde::{Deserialize, Serialize};

// Transfer/reporting types for copy, move, and queue updates.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyReport {
    pub copied: usize,
    pub skipped: usize,
    pub failures: Vec<String>,
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
pub struct TransferReport {
    pub copied: usize,
    pub moved: usize,
    pub skipped: usize,
    pub failures: Vec<String>,
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
}

#[derive(Clone)]
pub(crate) struct TransferProgressUpdate {
    pub processed: usize,
    pub total: usize,
    pub current_path: Option<String>,
    pub current_bytes: Option<u64>,
    pub current_total_bytes: Option<u64>,
    pub progress_percent: Option<f64>,
    pub status_text: Option<String>,
    pub rate_text: Option<String>,
}

// Optional per-item progress reporting for copy/transfer commands.
pub(crate) type TransferProgressCallback = dyn FnMut(TransferProgressUpdate);

// Optional cooperative transfer-control checks used by the backend manager.
pub(crate) type TransferControlCallback = dyn FnMut() -> Result<(), String>;

// Delete/trash report types.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    pub deleted: usize,
    pub skipped: usize,
    pub cancelled: bool,
    pub failures: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleEntry {
    pub original_path: String,
    pub info_path: String,
    pub data_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashReport {
    pub deleted: usize,
    pub skipped: usize,
    pub cancelled: bool,
    pub failures: Vec<String>,
    pub failed_paths: Vec<String>,
    pub recycled: Vec<RecycleEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub restored: usize,
    pub skipped: usize,
    pub failures: Vec<String>,
    pub remaining: Vec<RecycleEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePathsReport {
    pub restored: usize,
    pub skipped: usize,
    pub failures: Vec<String>,
    pub remaining_paths: Vec<String>,
}
