// Shared filesystem contracts used by listing, mutations, and command boundaries.
// Keeping these shapes in one place makes the module easier to scan from the outside.
use serde::{Deserialize, Serialize};

// Listing and metadata types shared with the UI.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortKey {
    Name,
    Size,
    Modified,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDir {
    Asc,
    Desc,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortState {
    pub key: SortKey,
    pub dir: SortDir,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirOptions {
    pub sort: Option<SortState>,
    pub search: Option<String>,
    pub fast: Option<bool>,
    // Generation counter from the UI; newer generations cancel older scans.
    pub generation: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirResult {
    pub entries: Vec<FileEntry>,
    pub total_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirWithParentResult {
    pub entries: Vec<FileEntry>,
    pub total_count: usize,
    pub parent_path: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub name: String,
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryMeta {
    pub path: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}

#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderThumbSampleBatchOptions {
    pub allow_videos: bool,
    pub allow_svgs: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FolderThumbSampleStatus {
    Ok,
    Empty,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderThumbSampleBatchResult {
    pub folder_path: String,
    pub sample_path: Option<String>,
    pub status: FolderThumbSampleStatus,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub path: String,
    pub free: Option<u64>,
    pub total: Option<u64>,
    pub label: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOptions {
    pub overwrite_paths: Option<Vec<String>>,
    pub skip_paths: Option<Vec<String>>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferMode {
    Copy,
    Move,
    Auto,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOptions {
    pub mode: Option<TransferMode>,
    pub overwrite: Option<bool>,
}
