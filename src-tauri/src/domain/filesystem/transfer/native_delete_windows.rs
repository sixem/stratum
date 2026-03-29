// Windows shell-native delete/recycle execution for managed jobs.
// Uses IFileOperation on an STA-initialized worker thread so the app keeps
// ownership of queue state, cancellation, and fallback prompts while still
// getting Explorer-like delete semantics.
use super::common::path_is_same_or_within;
use super::delete_discovery::{DeleteDiscoveryPlan, DeleteDiscoveryRoot};
use crate::domain::filesystem::fs_recycle_windows::can_use_recycle_bin;
use crate::domain::filesystem::{
    TransferControlCallback, TransferProgressCallback, TransferProgressUpdate,
};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::iter::once;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use windows::core::{implement, Error as WinError, PCWSTR, PWSTR};
use windows::Win32::Foundation::{E_ABORT, HWND};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FileOperation, IFileOperation, IFileOperationProgressSink, IFileOperationProgressSink_Impl,
    IShellItem, SHCreateItemFromParsingName, FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO,
    FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_FILESYSPATH,
};
use windows_core::{Result as WinResult, HRESULT};

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

struct ComGuard;

impl ComGuard {
    fn new() -> Result<Self, String> {
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        hr.ok().map_err(|err| err.to_string())?;
        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

struct DeleteOperationState {
    total_items: usize,
    processed_items: usize,
    current_path: Option<String>,
    on_progress: Option<*mut TransferProgressCallback>,
    on_control: Option<*mut TransferControlCallback>,
    roots: Vec<DeleteDiscoveryRoot>,
    root_failures: HashMap<String, String>,
    aborted: bool,
}

impl DeleteOperationState {
    fn emit_progress(&mut self, current_path: Option<String>) {
        let Some(handler) = self.on_progress else {
            return;
        };
        unsafe {
            (*handler)(TransferProgressUpdate {
                processed: self.processed_items.min(self.total_items),
                total: self.total_items,
                current_path,
                current_bytes: None,
                current_total_bytes: None,
                progress_percent: None,
                status_text: None,
                rate_text: None,
            });
        }
    }

    fn check_control(&mut self) -> WinResult<()> {
        let Some(handler) = self.on_control else {
            return Ok(());
        };
        match unsafe { (*handler)() } {
            Ok(()) => Ok(()),
            Err(_) => {
                self.aborted = true;
                Err(WinError::from_hresult(E_ABORT))
            }
        }
    }

    fn mark_processed(&mut self, current_path: Option<String>) {
        self.processed_items = self.processed_items.saturating_add(1).min(self.total_items);
        self.emit_progress(current_path);
    }

    fn root_for_path(&self, path: &str) -> Option<String> {
        let item_path = Path::new(path);
        self.roots
            .iter()
            .filter(|root| path_is_same_or_within(item_path, Path::new(&root.path)))
            .max_by_key(|root| root.path.len())
            .map(|root| root.path.clone())
    }

    fn record_failure(&mut self, path: Option<&str>, hrdelete: HRESULT) {
        let Some(path) = path.filter(|value| !value.trim().is_empty()) else {
            return;
        };
        let root_path = self.root_for_path(path).unwrap_or_else(|| path.to_string());
        self.root_failures
            .entry(root_path.clone())
            .or_insert_with(|| {
                format!(
                    "{}: {}",
                    root_path,
                    WinError::from_hresult(hrdelete).to_string()
                )
            });
    }
}

#[implement(IFileOperationProgressSink)]
struct ShellDeleteProgressSink {
    state: Arc<Mutex<DeleteOperationState>>,
}

impl ShellDeleteProgressSink {
    fn shell_item_path(item: windows::core::Ref<'_, IShellItem>) -> Option<String> {
        let shell_item = item.as_ref()?;
        read_shell_item_path(shell_item)
    }
}

impl IFileOperationProgressSink_Impl for ShellDeleteProgressSink_Impl {
    fn StartOperations(&self) -> WinResult<()> {
        let mut state = self.state.lock().expect("delete progress lock");
        state.check_control()
    }

    fn FinishOperations(&self, _hrresult: HRESULT) -> WinResult<()> {
        Ok(())
    }

    fn PreRenameItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
    ) -> WinResult<()> {
        Ok(())
    }

    fn PostRenameItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
        _hrrename: HRESULT,
        _psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
        Ok(())
    }

    fn PreMoveItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
    ) -> WinResult<()> {
        Ok(())
    }

    fn PostMoveItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
        _hrmove: HRESULT,
        _psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
        Ok(())
    }

    fn PreCopyItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
    ) -> WinResult<()> {
        Ok(())
    }

    fn PostCopyItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
        _hrcopy: HRESULT,
        _psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
        Ok(())
    }

    fn PreDeleteItem(
        &self,
        _dwflags: u32,
        psiitem: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
        let mut state = self.state.lock().expect("delete progress lock");
        state.check_control()?;
        let path = ShellDeleteProgressSink::shell_item_path(psiitem);
        state.current_path = path.clone();
        state.emit_progress(path);
        Ok(())
    }

    fn PostDeleteItem(
        &self,
        _dwflags: u32,
        psiitem: windows::core::Ref<'_, IShellItem>,
        hrdelete: HRESULT,
        _psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
        let mut state = self.state.lock().expect("delete progress lock");
        let path = ShellDeleteProgressSink::shell_item_path(psiitem);
        if hrdelete.is_err() {
            state.record_failure(path.as_deref(), hrdelete);
        }
        state.mark_processed(path);
        Ok(())
    }

    fn PreNewItem(
        &self,
        _dwflags: u32,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
    ) -> WinResult<()> {
        Ok(())
    }

    fn PostNewItem(
        &self,
        _dwflags: u32,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
        _psztemplatename: &PCWSTR,
        _dwfileattributes: u32,
        _hrnew: HRESULT,
        _psinewitem: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
        Ok(())
    }

    fn UpdateProgress(&self, _iworktotal: u32, _iworksofar: u32) -> WinResult<()> {
        let mut state = self.state.lock().expect("delete progress lock");
        state.check_control()
    }

    fn ResetTimer(&self) -> WinResult<()> {
        Ok(())
    }

    fn PauseTimer(&self) -> WinResult<()> {
        Ok(())
    }

    fn ResumeTimer(&self) -> WinResult<()> {
        Ok(())
    }
}

pub(crate) fn shell_delete_entries(
    discovery: Option<&DeleteDiscoveryPlan>,
    paths: Vec<String>,
    mode: ShellDeleteMode,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<ShellDeleteReport, String> {
    let _com = ComGuard::new()?;
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
    let sink: IFileOperationProgressSink = ShellDeleteProgressSink {
        state: Arc::clone(&sink_state),
    }
    .into();
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

fn create_file_operation() -> Result<IFileOperation, String> {
    unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_ALL) }.map_err(|err| err.to_string())
}

fn file_operation_flags(mode: ShellDeleteMode) -> windows::Win32::UI::Shell::FILEOPERATION_FLAGS {
    let mut flags = FOF_SILENT | FOF_NOCONFIRMATION | FOF_NOERRORUI;
    if mode == ShellDeleteMode::Recycle {
        flags |= FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE;
    }
    flags
}

fn shell_item_from_path(path: &str) -> Result<IShellItem, String> {
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).collect();
    unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None) }
        .map_err(|err| err.to_string())
}

fn read_shell_item_path(item: &IShellItem) -> Option<String> {
    unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }
        .ok()
        .map(read_pwstr_with_free)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            unsafe { item.GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING) }
                .ok()
                .map(read_pwstr_with_free)
                .filter(|value| !value.trim().is_empty())
        })
}

fn read_pwstr_with_free(value: PWSTR) -> String {
    if value.is_null() {
        return String::new();
    }
    let text = unsafe { String::from_utf16_lossy(value.as_wide()) };
    unsafe {
        CoTaskMemFree(Some(value.0 as *const _));
    }
    text
}
