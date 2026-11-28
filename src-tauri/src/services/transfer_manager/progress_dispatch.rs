// Progress throttling and progress-message formatting for transfer jobs.
// These dispatchers bridge low-level progress callbacks into event emission and snapshot updates.
use super::job_state_updates::{apply_planning_progress, apply_running_progress};
use super::manager_events::TransferEventEmitter;
use super::manager_state::TransferManagerInner;
use super::progress_batch::TransferProgressBatch;
use crate::domain::filesystem as fs;
use crate::domain::filesystem::transfer::delete_discovery::DeleteDiscoveryProgress;
use crate::domain::filesystem::transfer::job_plan::TransferProgressKind;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(125);
const SNAPSHOT_EMIT_INTERVAL: Duration = Duration::from_millis(350);
const MAX_COMPLETED_ITEMS_PER_BATCH: usize = 128;

pub(super) struct TransferProgressDispatcher {
    inner: Arc<TransferManagerInner>,
    job_id: String,
    progress_kind: TransferProgressKind,
    event_emitter: TransferEventEmitter,
    pending_batch: Option<TransferProgressBatch>,
    last_snapshot_emit: Option<Instant>,
}

pub(super) struct PlanningProgressDispatcher {
    inner: Arc<TransferManagerInner>,
    job_id: String,
    event_emitter: TransferEventEmitter,
    operation_label: &'static str,
    pending_update: Option<DeleteDiscoveryProgress>,
    last_progress_emit: Option<Instant>,
    last_snapshot_emit: Option<Instant>,
}

impl TransferProgressDispatcher {
    pub(super) fn new(
        inner: Arc<TransferManagerInner>,
        job_id: String,
        progress_kind: TransferProgressKind,
        event_emitter: TransferEventEmitter,
    ) -> Self {
        Self {
            inner,
            job_id,
            progress_kind,
            event_emitter,
            pending_batch: None,
            last_snapshot_emit: None,
        }
    }

    pub(super) fn handle_update(&mut self, update: fs::TransferProgressUpdate) {
        let batch = self
            .pending_batch
            .get_or_insert_with(TransferProgressBatch::default);
        batch.push(update);
        if batch.completed_items.len() >= MAX_COMPLETED_ITEMS_PER_BATCH {
            self.flush_pending(false);
        }
    }

    pub(super) fn start_flush_task(
        dispatcher: &Arc<Mutex<Self>>,
    ) -> tauri::async_runtime::JoinHandle<()> {
        let dispatcher = Arc::downgrade(dispatcher);
        tauri::async_runtime::spawn(async move {
            // A completed source must be released promptly even when the next
            // operation stalls before it can report progress.
            let mut interval = tokio::time::interval(PROGRESS_EMIT_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                let Some(dispatcher) = dispatcher.upgrade() else {
                    break;
                };
                let Ok(mut dispatcher) = dispatcher.lock() else {
                    break;
                };
                dispatcher.flush_pending(false);
            }
        })
    }

    pub(super) fn flush_all(&mut self) {
        self.flush_pending(true);
    }

    fn flush_pending(&mut self, force_snapshot: bool) {
        let Some(batch) = self.pending_batch.take() else {
            return;
        };

        let now = Instant::now();
        let snapshot_due = force_snapshot
            || self
                .last_snapshot_emit
                .map(|last| now.duration_since(last) >= SNAPSHOT_EMIT_INTERVAL)
                .unwrap_or(true);

        let snapshot = apply_running_progress(
            &self.inner,
            &self.job_id,
            self.progress_kind,
            &batch,
            snapshot_due,
        );
        self.event_emitter
            .emit(&batch.latest, batch.completed_items);

        if snapshot_due {
            if let Some(snapshot) = snapshot {
                self.event_emitter.emit_snapshot(&snapshot);
            }
            self.last_snapshot_emit = Some(now);
        }
    }
}

impl PlanningProgressDispatcher {
    pub(super) fn new(
        inner: Arc<TransferManagerInner>,
        job_id: String,
        event_emitter: TransferEventEmitter,
        operation_label: &'static str,
    ) -> Self {
        Self {
            inner,
            job_id,
            event_emitter,
            operation_label,
            pending_update: None,
            last_progress_emit: None,
            last_snapshot_emit: None,
        }
    }

    pub(super) fn emit_initial(&mut self) {
        self.pending_update = Some(DeleteDiscoveryProgress::default());
        self.flush_pending(true, true);
    }

    pub(super) fn handle_update(&mut self, update: DeleteDiscoveryProgress) {
        self.pending_update = Some(update);
        self.flush_pending(false, false);
    }

    pub(super) fn flush_all(&mut self) {
        self.flush_pending(true, true);
    }

    fn flush_pending(&mut self, force_progress: bool, force_snapshot: bool) {
        if self.pending_update.is_none() {
            return;
        }

        let now = Instant::now();
        let progress_due = force_progress
            || self
                .last_progress_emit
                .map(|last| now.duration_since(last) >= PROGRESS_EMIT_INTERVAL)
                .unwrap_or(true);
        if !progress_due {
            return;
        }
        let snapshot_due = force_snapshot
            || self
                .last_snapshot_emit
                .map(|last| now.duration_since(last) >= SNAPSHOT_EMIT_INTERVAL)
                .unwrap_or(true);

        let update = self
            .pending_update
            .take()
            .expect("pending planning update should exist");
        let snapshot = apply_planning_progress(&self.inner, &self.job_id, &update, snapshot_due);
        self.event_emitter.emit(
            &fs::TransferProgressUpdate {
                processed: 0,
                total: update.discovered_items,
                current_path: update.current_path.clone(),
                status_text: Some(build_discovery_status_text(
                    self.operation_label,
                    update.discovered_items,
                    update.discovered_bytes,
                )),
                rate_text: update
                    .current_path
                    .as_ref()
                    .map(|path| format!("Scanning {path}")),
                ..Default::default()
            },
            Vec::new(),
        );
        self.last_progress_emit = Some(now);

        if snapshot_due {
            if let Some(snapshot) = snapshot {
                self.event_emitter.emit_snapshot(&snapshot);
            }
            self.last_snapshot_emit = Some(now);
        }
    }
}

fn build_discovery_status_text(operation_label: &str, items: usize, bytes: u64) -> String {
    if items == 0 {
        return format!("Preparing to {operation_label}...");
    }

    let item_label = if items == 1 { "item" } else { "items" };
    format!(
        "Discovering {} {} ({})",
        format_count(items),
        item_label,
        format_bytes(bytes)
    )
}

fn format_count(value: usize) -> String {
    let digits = value.to_string();
    let mut reversed = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, ch) in digits.chars().rev().enumerate() {
        if index > 0 && index % 3 == 0 {
            reversed.push(',');
        }
        reversed.push(ch);
    }
    reversed.chars().rev().collect()
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit_index = 0usize;

    while value >= 1024.0 && unit_index + 1 < UNITS.len() {
        value /= 1024.0;
        unit_index += 1;
    }

    if unit_index == 0 {
        format!("{} {}", bytes, UNITS[unit_index])
    } else if value >= 10.0 {
        format!("{value:.0} {}", UNITS[unit_index])
    } else {
        format!("{value:.1} {}", UNITS[unit_index])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_item_completions_flush_during_a_pause_in_callbacks() {
        tauri::async_runtime::block_on(async {
            let inner = Arc::new(TransferManagerInner {
                events: Default::default(),
                state: Default::default(),
                queue_signal: Default::default(),
                next_job_id: Default::default(),
            });
            let dispatcher = Arc::new(Mutex::new(TransferProgressDispatcher::new(
                inner,
                "copy".into(),
                TransferProgressKind::Roots,
                TransferEventEmitter::silent(),
            )));
            dispatcher
                .lock()
                .unwrap()
                .handle_update(fs::TransferProgressUpdate {
                    completed_item: Some(fs::CompletedTransferItem {
                        path: "first.txt".into(),
                        source_removed: false,
                    }),
                    ..Default::default()
                });
            assert!(dispatcher.lock().unwrap().pending_batch.is_some());

            let task = TransferProgressDispatcher::start_flush_task(&dispatcher);
            let drained = tokio::time::timeout(Duration::from_secs(2), async {
                while dispatcher.lock().unwrap().pending_batch.is_some() {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await;
            task.abort();
            assert!(drained.is_ok());
        });
    }
}
