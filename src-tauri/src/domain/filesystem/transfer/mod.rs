// Transfer entry points for copy/move planning and execution.
// These modules keep planning, conflict checks, and execution concerns separate.
mod common;
pub(crate) mod delete_discovery;
pub(crate) mod destination;
mod execute;
pub(crate) mod job_plan;
mod manifest;
#[cfg(target_os = "windows")]
pub(crate) mod native_delete_windows;
#[cfg(target_os = "windows")]
mod native_windows;
mod plan;
mod strategy;
pub(crate) mod types;

pub(crate) use common::normalize_path_key;
pub(crate) use common::same_path;
pub(crate) use common::EntryKind;

pub(crate) fn kind_from_metadata(
    path: &std::path::Path,
    metadata: &std::fs::Metadata,
) -> EntryKind {
    common::entry_kind_for_transfer_kind(common::transfer_entry_kind(path, metadata))
}
#[cfg(windows)]
pub(crate) use common::windows_extended_path;
#[cfg(test)]
pub(crate) use execute::transfer_entries;
pub(crate) use execute::{copy_entries_reported, transfer_entries_reported};
#[cfg(windows)]
pub(crate) use execute::{CopiedMoveSources, PinnedMoveSource};
pub use plan::plan_copy_entries;

pub(crate) const TRANSFER_CANCELLED_MESSAGE: &str = "Transfer cancelled";
