// Shared job snapshot types for backend-managed file operations.
// The frontend consumes these snapshots to render queue state consistently.
use serde::Serialize;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferJobStatus {
    Queued,
    Running,
    Paused,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferJobPhase {
    Planning,
    Executing,
    Finalizing,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferJobKind {
    Transfer,
    Copy,
    Move,
    Delete,
    Trash,
    Conversion,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferJobCapabilities {
    pub can_pause: bool,
    pub can_cancel: bool,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferWorkEstimate {
    pub roots_total: usize,
    pub roots_completed: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_total: Option<usize>,
    pub files_completed: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
    pub bytes_completed: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferJobSnapshot {
    pub id: String,
    pub kind: TransferJobKind,
    pub status: TransferJobStatus,
    pub phase: TransferJobPhase,
    pub capabilities: TransferJobCapabilities,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_path: Option<String>,
    pub work: TransferWorkEstimate,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferQueueSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_job: Option<TransferJobSnapshot>,
    pub queued_jobs: Vec<TransferJobSnapshot>,
    pub completed_jobs: Vec<TransferJobSnapshot>,
}
