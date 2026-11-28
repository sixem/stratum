// Filesystem helpers backing the Tauri commands.
// This module is intentionally a narrow export map so contracts and behavior stay easy to scan.
mod created_folder;
mod entry_mutations;
pub(crate) mod file_identity;
mod fs_delete;
mod fs_list;
#[cfg(target_os = "windows")]
mod fs_recycle_windows;
mod fs_trash;
mod rename;
mod reports;
pub(crate) mod staging;
mod time;
pub(crate) mod transfer;
mod types;

pub use created_folder::{create_tracked_folder, remove_created_folder_if_empty, CreatedFolder};
pub use entry_mutations::{create_file, create_folder, ensure_dir};
pub use file_identity::EntryIdentity;
pub(crate) use fs_delete::delete_entries;
pub use fs_list::{
    get_home, get_places, list_dir, list_dir_with_parent, list_drive_info, list_drives,
    list_folder_thumb_samples_batch, parent_dir, stat_entries,
};
pub use fs_trash::restore_recycle_items;
pub(crate) use fs_trash::trash_entries;
pub use rename::{rename_entry, validate_batch_rename, BatchRenameRequest, RenamedEntry};
pub(crate) use reports::{
    CompletedFileWork, CompletedTransferItem, RemovedRoot, RootOutcome, RootReporter,
    TransferControlCallback, TransferProgressCallback, TransferProgressUpdate,
};
pub use reports::{
    CopyConflict, CopyConflictKind, CopyPlan, CopyReport, DeleteReport, MovedTransferEntry,
    RestoreRecycleReport, TransferProgress, TransferReport, TrashReport,
};
pub(crate) use time::to_epoch_ms;
pub use transfer::plan_copy_entries;
#[cfg(test)]
pub(crate) use transfer::transfer_entries;
pub use transfer::types::TransferQueueSnapshot;
pub use types::{
    CopyOptions, DriveInfo, EntryMeta, FileEntry, FilePane, FolderThumbSampleBatchOptions,
    FolderThumbSampleBatchResult, FolderThumbSampleStatus, ListDirOptions, ListDirResult,
    ListDirWithParentResult, Place, SortDir, SortKey, SortState, TransferMode, TransferOptions,
};
