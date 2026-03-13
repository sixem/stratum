// Sequential backend work queue used by filesystem and conversion commands.
// The public handle stays small here while submodules own state, events, and execution.
#[path = "transfer_manager/control.rs"]
mod control;
#[path = "transfer_manager/manager_events.rs"]
mod manager_events;
#[path = "transfer_manager/manager_queue.rs"]
mod manager_queue;
#[path = "transfer_manager/manager_run.rs"]
mod manager_run;
#[path = "transfer_manager/manager_state.rs"]
mod manager_state;

use std::sync::Arc;

use self::manager_state::TransferManagerInner;

#[derive(Clone)]
pub struct TransferManagerHandle {
    inner: Arc<TransferManagerInner>,
}
