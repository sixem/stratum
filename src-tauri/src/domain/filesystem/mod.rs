// Filesystem helpers backing the Tauri commands.
// Types and public exports live here; implementations are split into focused submodules.
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

mod fs_delete;
mod fs_list;
#[cfg(target_os = "windows")]
mod fs_recycle_windows;
mod fs_trash;
pub(crate) mod transfer;

pub(crate) use fs_delete::delete_entries;
pub use fs_list::{
    get_home, get_places, list_dir, list_dir_with_parent, list_drive_info, list_drives,
    list_folder_thumb_samples_batch, parent_dir, stat_entries,
};
pub(crate) use fs_trash::trash_entries;
pub use fs_trash::{restore_recycle_entries, restore_recycle_paths};
pub use transfer::types::TransferQueueSnapshot;
pub use transfer::{copy_entries, plan_copy_entries, transfer_entries};

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

// Transfer/reporting types for copy/move operations.
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
}

#[derive(Clone)]
pub(crate) struct TransferProgressUpdate {
    pub processed: usize,
    pub total: usize,
    pub current_path: Option<String>,
    pub current_bytes: Option<u64>,
    pub current_total_bytes: Option<u64>,
}

// Optional per-item progress reporting for copy/transfer commands.
pub(crate) type TransferProgressCallback = dyn FnMut(TransferProgressUpdate);

// Optional cooperative transfer-control checks used by the backend manager.
pub(crate) type TransferControlCallback = dyn FnMut() -> Result<(), String>;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOptions {
    pub mode: Option<TransferMode>,
    pub overwrite: Option<bool>,
}

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

// Convert filesystem timestamps into epoch milliseconds for the UI.
fn to_epoch_ms(time: SystemTime) -> Option<u64> {
    // Use epoch milliseconds so the UI can format locally.
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

// Ensure a directory tree exists before filesystem operations.
pub fn ensure_dir(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Empty path".to_string());
    }
    fs::create_dir_all(trimmed).map_err(|err| err.to_string())
}

fn validate_new_entry_path(target: &Path) -> Result<(), String> {
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() || name == "." || name == ".." {
        return Err("Invalid name".to_string());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot include path separators".to_string());
    }
    Ok(())
}

// Create a new folder entry at the requested path.
pub fn create_folder(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Empty path".to_string());
    }
    let target = PathBuf::from(trimmed);
    validate_new_entry_path(&target)?;
    if target.exists() {
        return Err("A file or folder with that name already exists.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "Unable to resolve parent directory".to_string())?;
    if !parent.exists() {
        return Err("Parent folder does not exist".to_string());
    }
    fs::create_dir(&target).map_err(|err| err.to_string())
}

// Create a new empty file entry at the requested path.
pub fn create_file(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Empty path".to_string());
    }
    let target = PathBuf::from(trimmed);
    validate_new_entry_path(&target)?;
    if target.exists() {
        return Err("A file or folder with that name already exists.".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "Unable to resolve parent directory".to_string())?;
    if !parent.exists() {
        return Err("Parent folder does not exist".to_string());
    }
    fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&target)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

// Rename a file or folder within its current parent directory.
pub fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Empty source path".to_string());
    }
    let name = new_name.trim();
    if name.is_empty() {
        return Err("Empty destination name".to_string());
    }
    if name == "." || name == ".." {
        return Err("Invalid name".to_string());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot include path separators".to_string());
    }

    let source = PathBuf::from(trimmed);
    if !source.exists() {
        return Err("Source does not exist".to_string());
    }
    let parent = source
        .parent()
        .ok_or_else(|| "Unable to resolve parent directory".to_string())?;
    let dest = parent.join(name);
    let source_string = source.to_string_lossy().to_string();
    let dest_string = dest.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        if source_string.eq_ignore_ascii_case(&dest_string) {
            return Ok(source_string);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if source_string == dest_string {
            return Ok(source_string);
        }
    }

    if dest.exists() {
        return Err("A file or folder with that name already exists.".to_string());
    }

    fs::rename(&source, &dest).map_err(|err| err.to_string())?;
    Ok(dest_string)
}
