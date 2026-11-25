// Progress emitters for manifest-driven copy and move execution.
// Keeping these payload builders together makes the orchestration code easier
// to scan and keeps the hot loops focused on filesystem work.
use super::super::common::emit_transfer_progress;
use super::super::manifest::TransferManifestEntry;
use crate::domain::filesystem::{
    CompletedFileWork, CompletedTransferItem, TransferProgressCallback, TransferProgressUpdate,
};
use std::path::Path;

pub(super) fn emit_root_completion(
    path: String,
    source_removed: bool,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            completed_item: Some(CompletedTransferItem {
                path,
                source_removed,
            }),
            ..Default::default()
        },
    );
}

pub(super) fn emit_path_progress(
    source: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: Some(source.to_string_lossy().into_owned()),
            ..Default::default()
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
            ..Default::default()
        },
    );
}

pub(super) fn emit_file_bytes(
    processed: usize,
    total: usize,
    current_bytes: u64,
    current_total_bytes: u64,
    completed_file_work: Option<CompletedFileWork>,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_bytes: Some(current_bytes),
            current_total_bytes: Some(current_total_bytes),
            completed_file_work,
            ..Default::default()
        },
    );
}

pub(super) fn emit_manifest_move_completion(
    root: &super::super::manifest::TransferManifestRoot,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) {
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            completed_file_work: Some(CompletedFileWork {
                files: root.file_count,
                bytes: root.byte_count,
            }),
            ..Default::default()
        },
    );
}
