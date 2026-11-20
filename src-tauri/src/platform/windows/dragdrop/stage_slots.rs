// Reserve one full per-drop budget before creating any temporary output.
use super::{data::DropDataError, staging::StageDirectory};
use std::sync::{Arc, Mutex};

pub(super) const MAX_STAGED_DROPS: usize = 4;

#[derive(Default)]
pub(super) struct StageSlots(Arc<Mutex<SlotState>>);

#[derive(Default)]
struct SlotState {
    allocated: usize,
    failed_cleanup: Vec<StageDirectory>,
}

impl StageSlots {
    pub(super) fn reserve(&self) -> Result<StageSlot, DropDataError> {
        self.try_reserve()
            .or_else(|| {
                self.retry_cleanup();
                self.try_reserve()
            })
            .ok_or(DropDataError::StagingBusy)
    }

    fn try_reserve(&self) -> Option<StageSlot> {
        let mut state = self.0.lock().expect("drop stage slots poisoned");
        if state.allocated >= MAX_STAGED_DROPS {
            return None;
        }
        state.allocated += 1;
        Some(StageSlot {
            state: Arc::clone(&self.0),
            failed_cleanup: None,
        })
    }

    fn retry_cleanup(&self) {
        // Temporarily locked files still count against the limit. Retry only
        // when capacity runs out, and keep filesystem work outside the lock.
        let directories = std::mem::take(
            &mut self
                .0
                .lock()
                .expect("drop stage slots poisoned")
                .failed_cleanup,
        );
        for directory in directories {
            let removed = directory.retry_cleanup().is_ok();
            let mut state = self.0.lock().expect("drop stage slots poisoned");
            if removed {
                state.allocated -= 1;
            } else {
                state.failed_cleanup.push(directory);
            }
        }
    }
}

pub(super) struct StageSlot {
    state: Arc<Mutex<SlotState>>,
    failed_cleanup: Option<StageDirectory>,
}

impl StageSlot {
    pub(super) fn defer_cleanup(&mut self, directory: StageDirectory) {
        self.failed_cleanup = Some(directory);
    }
}

impl Drop for StageSlot {
    fn drop(&mut self) {
        let mut state = self.state.lock().expect("drop stage slots poisoned");
        if let Some(directory) = self.failed_cleanup.take() {
            state.failed_cleanup.push(directory);
        } else {
            state.allocated -= 1;
        }
    }
}
