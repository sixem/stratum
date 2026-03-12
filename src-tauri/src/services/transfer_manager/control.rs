// Cooperative job-control primitives for the backend transfer manager.
// Jobs block on this state when paused and exit cleanly when cancelled.
use std::sync::{Arc, Condvar, Mutex};

pub const TRANSFER_CANCELLED_MESSAGE: &str = "Transfer cancelled";

#[derive(Clone)]
pub(super) struct TransferJobControlHandle {
    inner: Arc<TransferJobControlState>,
}

struct TransferJobControlState {
    state: Mutex<TransferJobControl>,
    wake: Condvar,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TransferJobControl {
    Running,
    Paused,
    Cancelled,
}

impl TransferJobControlHandle {
    pub(super) fn new() -> Self {
        Self {
            inner: Arc::new(TransferJobControlState {
                state: Mutex::new(TransferJobControl::Running),
                wake: Condvar::new(),
            }),
        }
    }

    pub(super) fn pause(&self) -> Result<bool, String> {
        let mut guard = self
            .inner
            .state
            .lock()
            .map_err(|_| "transfer control unavailable".to_string())?;
        if *guard != TransferJobControl::Running {
            return Ok(false);
        }
        *guard = TransferJobControl::Paused;
        Ok(true)
    }

    pub(super) fn resume(&self) -> Result<bool, String> {
        let mut guard = self
            .inner
            .state
            .lock()
            .map_err(|_| "transfer control unavailable".to_string())?;
        if *guard != TransferJobControl::Paused {
            return Ok(false);
        }
        *guard = TransferJobControl::Running;
        self.inner.wake.notify_all();
        Ok(true)
    }

    pub(super) fn cancel(&self) -> Result<bool, String> {
        let mut guard = self
            .inner
            .state
            .lock()
            .map_err(|_| "transfer control unavailable".to_string())?;
        if *guard == TransferJobControl::Cancelled {
            return Ok(false);
        }
        *guard = TransferJobControl::Cancelled;
        self.inner.wake.notify_all();
        Ok(true)
    }

    pub(super) fn checkpoint(&self) -> Result<(), String> {
        let mut guard = self
            .inner
            .state
            .lock()
            .map_err(|_| "transfer control unavailable".to_string())?;

        loop {
            match *guard {
                TransferJobControl::Running => return Ok(()),
                TransferJobControl::Paused => {
                    guard = self
                        .inner
                        .wake
                        .wait(guard)
                        .map_err(|_| "transfer control unavailable".to_string())?;
                }
                TransferJobControl::Cancelled => {
                    return Err(TRANSFER_CANCELLED_MESSAGE.to_string());
                }
            }
        }
    }
}
