// Windows shell-native delete/recycle execution for managed jobs.
// Uses IFileOperation on an STA-initialized worker thread so the app keeps
// ownership of queue state, cancellation, and fallback prompts while still
// getting Explorer-like delete semantics.
use super::delete_discovery::{DeleteDiscoveryPlan, DeleteDiscoveryRoot};
use crate::domain::filesystem::fs_recycle_windows::can_use_recycle_bin;
use crate::domain::filesystem::{
    TransferControlCallback, TransferProgressCallback,
};
use crate::platform::windows::com::StaComGuard;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
mod file_operation;
mod progress_sink;
mod shell_items;

use self::file_operation::{create_file_operation, file_operation_flags};
use self::progress_sink::{create_progress_sink, DeleteOperationState};
use self::shell_items::shell_item_from_path;
use windows::Win32::Foundation::{E_ABORT, HWND};
use windows::Win32::UI::Shell::{
    IFileOperationProgressSink,
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShellDeleteMode {
    Recycle,
    Permanent,
}

#[derive(Default)]
pub(crate) struct ShellDeleteReport {
    pub completed_paths: Vec<String>,
    pub remaining_paths: Vec<String>,
    pub cancelled: bool,
    pub failures: Vec<String>,
}

pub(crate) fn shell_delete_entries(
    discovery: Option<&DeleteDiscoveryPlan>,
    paths: Vec<String>,
    mode: ShellDeleteMode,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<ShellDeleteReport, String> {
    let _com = StaComGuard::new()?;
    let discovery = discovery
        .cloned()
        .unwrap_or_else(|| fallback_delete_discovery(&paths));
    let total_items = discovery.item_count.max(discovery.roots.len());
    let progress_ptr = on_progress
        .as_deref_mut()
        .map(|handler| handler as *mut TransferProgressCallback);
    let control_ptr = on_control
        .as_deref_mut()
        .map(|handler| handler as *mut TransferControlCallback);

    let file_operation = create_file_operation()?;
    unsafe {
        file_operation
            .SetOwnerWindow(HWND::default())
            .map_err(|err| err.to_string())?;
        file_operation
            .SetOperationFlags(file_operation_flags(mode))
            .map_err(|err| err.to_string())?;
    }

    let sink_state = Arc::new(Mutex::new(DeleteOperationState {
        total_items,
        processed_items: 0,
        current_path: None,
        on_progress: progress_ptr,
        on_control: control_ptr,
        roots: discovery.roots.clone(),
        root_failures: HashMap::new(),
        aborted: false,
    }));
    let sink: IFileOperationProgressSink = create_progress_sink(Arc::clone(&sink_state));
    let cookie = unsafe { file_operation.Advise(&sink) }.map_err(|err| err.to_string())?;

    let mut queued_roots = Vec::new();
    let mut report = ShellDeleteReport::default();

    for root in &discovery.roots {
        if let Some(handler) = on_control.as_mut() {
            if let Err(error) = handler() {
                report.cancelled = true;
                if error.trim() == "Transfer cancelled" {
                    report
                        .remaining_paths
                        .extend(discovery.roots.iter().map(|value| value.path.clone()));
                    let _ = unsafe { file_operation.Unadvise(cookie) };
                    return Ok(report);
                }
                let _ = unsafe { file_operation.Unadvise(cookie) };
                return Err(error);
            }
        }

        if mode == ShellDeleteMode::Recycle && !can_use_recycle_bin(Path::new(&root.path)) {
            report.remaining_paths.push(root.path.clone());
            report
                .failures
                .push(format!("{}: Recycle Bin unavailable", root.path));
            continue;
        }

        let item = match shell_item_from_path(&root.path) {
            Ok(item) => item,
            Err(error) => {
                report.remaining_paths.push(root.path.clone());
                report.failures.push(format!("{}: {}", root.path, error));
                continue;
            }
        };

        if let Err(error) =
            unsafe { file_operation.DeleteItem(&item, None::<&IFileOperationProgressSink>) }
        {
            let _ = unsafe { file_operation.Unadvise(cookie) };
            return Err(error.to_string());
        }
        queued_roots.push(root.path.clone());
    }

    if queued_roots.is_empty() {
        let _ = unsafe { file_operation.Unadvise(cookie) };
        return Ok(report);
    }

    let perform_error = unsafe { file_operation.PerformOperations() }.err();
    let any_aborted = unsafe { file_operation.GetAnyOperationsAborted() }
        .map(|value| value.as_bool())
        .unwrap_or(false);
    let _ = unsafe { file_operation.Unadvise(cookie) };

    let mut sink_state = sink_state
        .lock()
        .map_err(|_| "delete progress lock".to_string())?;
    report.cancelled = any_aborted
        || sink_state.aborted
        || perform_error
            .as_ref()
            .map(|error| error.code() == E_ABORT)
            .unwrap_or(false);

    if let Some(error) = perform_error.as_ref() {
        if error.code() != E_ABORT {
            report.failures.push(error.to_string());
        }
    }

    for root in queued_roots {
        if Path::new(&root).exists() {
            report.remaining_paths.push(root.clone());
            if let Some(message) = sink_state.root_failures.remove(&root) {
                report.failures.push(message);
            } else if !report
                .failures
                .iter()
                .any(|message| message.starts_with(&format!("{root}:")))
            {
                report
                    .failures
                    .push(format!("{root}: Delete did not complete"));
            }
        } else {
            report.completed_paths.push(root);
        }
    }

    Ok(report)
}

fn fallback_delete_discovery(paths: &[String]) -> DeleteDiscoveryPlan {
    let mut plan = DeleteDiscoveryPlan::default();
    for raw_path in paths {
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            continue;
        }
        plan.roots.push(DeleteDiscoveryRoot {
            path: trimmed.to_string(),
            item_count: 1,
            byte_count: 0,
        });
    }
    plan.item_count = plan.roots.len();
    plan
}
