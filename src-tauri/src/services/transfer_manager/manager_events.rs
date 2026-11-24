// Event emission helpers for managed file-operation jobs.
// Keeping this separate makes the queue and execution code easier to scan.
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::types::TransferQueueSnapshot;
#[cfg(not(test))]
use tauri::{Emitter, Manager};

#[derive(Clone)]
pub(super) struct TransferEventEmitter {
    #[cfg(not(test))]
    app_handle: tauri::AppHandle,
    transfer_id: Option<String>,
}

impl TransferEventEmitter {
    #[cfg(test)]
    pub(super) fn silent() -> Self {
        Self { transfer_id: None }
    }

    pub(super) fn emit(
        &self,
        update: &fs::TransferProgressUpdate,
        completed_items: Vec<fs::CompletedTransferItem>,
    ) {
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
            completed_items,
        };
        self.send("transfer_progress", payload);
    }

    pub(super) fn emit_snapshot(&self, snapshot: &TransferQueueSnapshot) {
        self.send("transfer_jobs_snapshot", snapshot);
    }

    fn send(&self, event: &str, payload: impl serde::Serialize + Clone) {
        #[cfg(not(test))]
        let _ = self.app_handle.emit(event, payload);
        // The worker tests run without a window or webview.
        #[cfg(test)]
        let _ = (event, payload);
    }
}

pub(super) fn build_event_emitter(
    window: tauri::Window,
    transfer_id: Option<String>,
) -> TransferEventEmitter {
    #[cfg(test)]
    let _ = window;
    let trimmed = transfer_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    TransferEventEmitter {
        #[cfg(not(test))]
        app_handle: window.app_handle().clone(),
        transfer_id: trimmed,
    }
}
