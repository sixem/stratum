// Gate new work while closing and wait for the current queue to settle.
use super::manager_state::{snapshot_from_state, TransferManagerState};
use super::TransferManagerHandle;
use crate::domain::filesystem::transfer::types::TransferJobStatus;
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferShutdownMode {
    IdleOnly,
    Wait,
    Cancel,
}

impl TransferManagerState {
    fn has_unsettled_work(&self) -> bool {
        !self.active_jobs.is_empty()
            || !self.queued_jobs.is_empty()
            || self.planning_jobs > 0
            || self.releasing_jobs > 0
    }

    fn reserve_shutdown(&mut self) -> u64 {
        self.next_shutdown_ticket += 1;
        self.shutdown_ticket = Some(self.next_shutdown_ticket);
        self.next_shutdown_ticket
    }

    fn cancel_for_shutdown(&self) {
        for job in &self.active_jobs {
            let _ = job.control.cancel();
        }
        for job in &self.queued_jobs {
            let _ = job.request.control.cancel();
        }
    }
}

impl TransferManagerHandle {
    pub fn begin_shutdown(&self, mode: TransferShutdownMode) -> Result<Option<u64>, String> {
        let (ticket, resumed) = {
            let mut guard = self.inner.state.lock().map_err(|_| state_unavailable())?;
            if guard.shutdown_ticket.is_some() {
                return Err("Stratum is already closing.".to_string());
            }
            if matches!(mode, TransferShutdownMode::IdleOnly) && guard.has_unsettled_work() {
                return Ok(None);
            }

            let mut resumed_emitter = None;
            match mode {
                TransferShutdownMode::IdleOnly => {}
                TransferShutdownMode::Wait => {
                    // A close that waits for completion should not be held by a paused job.
                    for job in &mut guard.active_jobs {
                        if job.control.resume()? {
                            job.snapshot.status = TransferJobStatus::Running;
                            resumed_emitter = Some(job.event_emitter.clone());
                        }
                    }
                }
                TransferShutdownMode::Cancel => guard.cancel_for_shutdown(),
            }
            let ticket = guard.reserve_shutdown();
            let resumed = resumed_emitter.map(|emitter| (emitter, snapshot_from_state(&mut guard)));
            (ticket, resumed)
        };
        self.inner.queue_signal.notify_all();
        if let Some((emitter, snapshot)) = resumed {
            emitter.emit_snapshot(&snapshot);
        }
        Ok(Some(ticket))
    }

    pub fn wait_for_shutdown(&self, ticket: u64) -> Result<bool, String> {
        let mut guard = self.inner.state.lock().map_err(|_| state_unavailable())?;
        while guard.shutdown_ticket == Some(ticket) {
            if !guard.has_unsettled_work() {
                return Ok(true);
            }
            guard = self
                .inner
                .queue_signal
                .wait(guard)
                .map_err(|_| state_unavailable())?;
        }
        Ok(false)
    }

    pub fn reopen_queue(&self, ticket: u64) -> Result<bool, String> {
        let mut guard = self.inner.state.lock().map_err(|_| state_unavailable())?;
        if guard.shutdown_ticket != Some(ticket) || guard.process_exit_requested {
            return Ok(false);
        }
        guard.shutdown_ticket = None;
        self.inner.queue_signal.notify_all();
        Ok(true)
    }

    /// An exit requested outside the webview has no UI to negotiate with.
    /// Defer it until cancellation has unwound, then request exit again.
    pub fn defer_process_exit(
        &self,
        app: &tauri::AppHandle,
        code: Option<i32>,
        api: &tauri::ExitRequestApi,
    ) -> bool {
        let ticket = {
            let Ok(mut guard) = self.inner.state.lock() else {
                return false;
            };
            if guard.shutdown_ticket.is_none() {
                guard.reserve_shutdown();
            }
            if !guard.has_unsettled_work() || code == Some(tauri::RESTART_EXIT_CODE) {
                return false;
            }
            api.prevent_exit();
            if guard.process_exit_requested {
                return true;
            }
            guard.process_exit_requested = true;
            guard.cancel_for_shutdown();
            guard
                .shutdown_ticket
                .expect("process exit reserves the transfer queue")
        };
        self.inner.queue_signal.notify_all();
        let app = app.clone();
        let manager = self.clone();
        tauri::async_runtime::spawn_blocking(move || match manager.wait_for_shutdown(ticket) {
            Ok(true) => app.exit(code.unwrap_or(0)),
            Ok(false) => {}
            Err(error) => eprintln!("Could not finish jobs before exiting: {error}"),
        });
        true
    }
}

fn state_unavailable() -> String {
    "transfer manager state unavailable".to_string()
}
