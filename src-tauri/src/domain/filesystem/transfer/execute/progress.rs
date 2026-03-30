// Progress emitters for manifest-driven copy and move execution.
// Keeping these payload builders together makes the orchestration code easier
// to scan and keeps the hot loops focused on filesystem work.
use super::super::manifest::TransferManifestEntry;
use crate::domain::filesystem::{
    TransferProgressCallback, TransferProgressUpdate,
};
use super::super::common::emit_transfer_progress;

pub(super) fn emit_root_completion(
    on_progress: &mut Option<&mut TransferProgressCallback>,
    processed: usize,
    total: usize,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: None,
            current_bytes: None,
            current_total_bytes: None,
            progress_percent: None,
            status_text: None,
            rate_text: None,
        },
    );
}

pub(super) fn emit_directory_progress(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: Some(entry.source.to_string_lossy().to_string()),
            current_bytes: None,
            current_total_bytes: None,
            progress_percent: None,
            status_text: None,
            rate_text: None,
        },
    );
}

pub(super) fn emit_file_start(
    entry: &TransferManifestEntry,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: Some(entry.source.to_string_lossy().to_string()),
            current_bytes: Some(0),
            current_total_bytes: Some(entry.bytes_total),
            progress_percent: None,
            status_text: None,
            rate_text: None,
        },
    );
}

pub(super) fn emit_file_bytes(
    processed: usize,
    total: usize,
    current_bytes: u64,
    current_total_bytes: u64,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: None,
            current_bytes: Some(current_bytes),
            current_total_bytes: Some(current_total_bytes),
            progress_percent: None,
            status_text: None,
            rate_text: None,
        },
    );
}
