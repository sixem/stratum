// Bounded backend work queue used by filesystem and conversion commands.
// The public handle stays small here while submodules own state, events, and execution.
#[path = "transfer_manager/control.rs"]
mod control;
#[path = "transfer_manager/job_execution.rs"]
mod job_execution;
#[path = "transfer_manager/job_paths.rs"]
mod job_paths;
#[path = "transfer_manager/job_planning.rs"]
mod job_planning;
#[path = "transfer_manager/job_state_updates.rs"]
mod job_state_updates;
#[path = "transfer_manager/local_events.rs"]
mod local_events;
#[path = "transfer_manager/manager_events.rs"]
mod manager_events;
#[path = "transfer_manager/manager_queue.rs"]
mod manager_queue;
#[path = "transfer_manager/manager_run.rs"]
mod manager_run;
#[path = "transfer_manager/manager_shutdown.rs"]
mod manager_shutdown;
#[path = "transfer_manager/manager_state.rs"]
mod manager_state;
#[path = "transfer_manager/progress_batch.rs"]
mod progress_batch;
#[path = "transfer_manager/progress_dispatch.rs"]
mod progress_dispatch;
#[cfg(windows)]
#[path = "transfer_manager/remote_events.rs"]
mod remote_events;

use std::sync::Arc;

pub use self::manager_shutdown::TransferShutdownMode;
use self::manager_state::TransferManagerInner;

#[derive(Clone)]
pub struct TransferManagerHandle {
    inner: Arc<TransferManagerInner>,
}
