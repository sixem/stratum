#![allow(dead_code)]

// Shared indexed-search contracts used by the backend service and frontend
// command surface. Keeping these shapes together makes the new subsystem
// easier to scan before the heavier indexing logic lands.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexedSearchServiceState {
    Disabled,
    Starting,
    Scanning,
    Idle,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedSearchServiceStatus {
    pub state: IndexedSearchServiceState,
    pub catalog_revision: u64,
    pub activity_label: Option<String>,
    pub started_at: u64,
    pub last_updated_at: u64,
    pub drive_count: usize,
    pub indexable_drive_count: usize,
    pub searchable_drive_count: usize,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexedDriveState {
    Unknown,
    Queued,
    Scanning,
    Ready,
    Saved,
    Unsupported,
    Unavailable,
    Stale,
    RescanRequired,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedDriveStatus {
    pub drive_path: String,
    pub filesystem: Option<String>,
    pub state: IndexedDriveState,
    pub indexable: bool,
    pub searchable: bool,
    // Tracks when the current coarse state began so future UI can derive
    // durations without needing to redesign the contract.
    pub started_at: Option<u64>,
    pub last_updated_at: u64,
    pub entry_count: Option<u64>,
    pub source_label: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexedEntryKind {
    File,
    Directory,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedPathMatch {
    pub path: String,
    pub name: String,
    pub parent_path: Option<String>,
    pub drive_path: Option<String>,
    pub kind: IndexedEntryKind,
    pub size_bytes: Option<u64>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedPathQuery {
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedPathPageQuery {
    #[serde(flatten)]
    pub search: IndexedPathQuery,
    pub cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedFolderPageQuery {
    #[serde(default)]
    pub search: String,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
    #[serde(flatten)]
    pub scope: IndexedFolderScope,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedFolderScope {
    // None searches all verified drives. An empty allowlist searches none.
    pub scope_roots: Option<Vec<String>>,
    pub max_depth: Option<usize>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedPathPage {
    pub matches: Vec<IndexedPathMatch>,
    pub next_cursor: Option<String>,
}

impl IndexedPathQuery {
    // The search planner and cache must agree on which limits are equivalent.
    pub(crate) fn effective_limit(&self) -> usize {
        const DEFAULT_LIMIT: usize = 50;
        const MAX_LIMIT: usize = 100;
        self.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
    }
}
