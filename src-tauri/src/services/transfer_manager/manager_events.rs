// Event emission helpers for managed file-operation jobs.
// Keeping this separate makes the queue and execution code easier to scan.
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::types::TransferQueueSnapshot;
use tauri::Emitter;
use tauri::Manager;

#[derive(Clone)]
pub(super) struct TransferEventEmitter {
    app_handle: tauri::AppHandle,
    transfer_id: Option<String>,
}

impl TransferEventEmitter {
    pub(super) fn emit(&self, update: &fs::TransferProgressUpdate) {
        let Some(transfer_id) = self.transfer_id.clone() else {
            return;
        };
        let payload = fs::TransferProgress {
            id: transfer_id,
            processed: update.processed,
            total: update.total,
            current_path: update.current_path.clone(),
            current_bytes: update.current_bytes,
            current_total_bytes: update.current_total_bytes,
            progress_percent: update.progress_percent,
            status_text: update.status_text.clone(),
            rate_text: update.rate_text.clone(),
        };
        let _ = self.app_handle.emit("transfer_progress", payload);
    }

    pub(super) fn emit_snapshot(&self, snapshot: &TransferQueueSnapshot) {
        let _ = self
            .app_handle
            .emit("transfer_jobs_snapshot", snapshot.clone());
    }
}

pub(super) fn build_event_emitter(
    window: tauri::Window,
    transfer_id: Option<String>,
) -> TransferEventEmitter {
    let trimmed = transfer_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    TransferEventEmitter {
        app_handle: window.app_handle().clone(),
        transfer_id: trimmed,
    }
}
