// Combine high-frequency file callbacks while keeping committed work separate
// from the latest file's in-flight bytes and presentation hints.
use crate::domain::filesystem::{CompletedFileWork, CompletedTransferItem, TransferProgressUpdate};

#[derive(Default)]
pub(super) struct TransferProgressBatch {
    pub(super) latest: TransferProgressUpdate,
    pub(super) completed_items: Vec<CompletedTransferItem>,
    pub(super) file_work: CompletedFileWork,
    pub(super) in_flight_bytes: u64,
}

impl TransferProgressBatch {
    pub(super) fn push(&mut self, mut update: TransferProgressUpdate) {
        self.in_flight_bytes = update
            .current_bytes
            .unwrap_or_default()
            .min(update.current_total_bytes.unwrap_or_default());
        if let Some(work) = update.completed_file_work.take() {
            self.file_work.files = self.file_work.files.saturating_add(work.files);
            self.file_work.bytes = self.file_work.bytes.saturating_add(work.bytes);
            self.in_flight_bytes = 0;
        }
        if let Some(item) = update.completed_item.take() {
            self.completed_items.push(item);
        }

        let previous = &mut self.latest;
        // Byte callbacks may omit the path, while a new path ends the previous
        // file's progress and labels even if both arrive in the same batch.
        if update.current_path.is_none() || update.current_path == previous.current_path {
            update.current_path = update.current_path.or_else(|| previous.current_path.take());
            update.current_bytes = update.current_bytes.or(previous.current_bytes);
            update.current_total_bytes =
                update.current_total_bytes.or(previous.current_total_bytes);
            update.progress_percent = update.progress_percent.or(previous.progress_percent);
            update.status_text = update.status_text.or_else(|| previous.status_text.take());
            update.rate_text = update.rate_text.or_else(|| previous.rate_text.take());
        }
        self.latest = update;
    }
}
