// Transfer entry points for copy/move planning and execution.
// These modules keep planning, conflict checks, and execution concerns separate.
mod common;
mod execute;
pub(crate) mod job_plan;
mod manifest;
#[cfg(target_os = "windows")]
mod native_windows;
mod plan;
pub(crate) mod types;

pub use execute::{copy_entries, transfer_entries};
pub use plan::plan_copy_entries;
