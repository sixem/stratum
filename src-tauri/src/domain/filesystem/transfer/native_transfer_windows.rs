// Windows shell-native transfer execution for simple move/copy roots.
// This gives the fast path Explorer-style semantics while keeping queue state
// and cooperative pause/cancel logic inside Stratum's backend.
use crate::domain::filesystem::{
    TransferControlCallback, TransferProgressCallback, TransferProgressUpdate,
};
use crate::platform::windows::com::StaComGuard;
use std::ffi::OsStr;
use std::iter::once;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use windows::core::{implement, Error as WinError, PCWSTR, PWSTR};
use windows::Win32::Foundation::{E_ABORT, HWND};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
use windows::Win32::UI::Shell::{
    FileOperation, IFileOperation, IFileOperationProgressSink, IFileOperationProgressSink_Impl,
    IShellItem, SHCreateItemFromParsingName, FILEOPERATION_FLAGS, FOFX_ADDUNDORECORD,
    FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOCONFIRMMKDIR, FOF_NOERRORUI, FOF_SILENT,
    SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_FILESYSPATH,
};
use windows_core::{Result as WinResult, HRESULT};

const TRANSFER_CANCELLED_MESSAGE: &str = "Transfer cancelled";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShellTransferMode {
    Move,
    Copy,
}

struct ShellTransferState {
    processed_roots: usize,
    total_roots: usize,
    root_path: String,
    current_path: Option<String>,
    failure: Option<String>,
    on_progress: Option<*mut TransferProgressCallback>,
    on_control: Option<*mut TransferControlCallback>,
    aborted: bool,
}

impl ShellTransferState {
    fn emit_progress(&mut self, processed_roots: usize, current_path: Option<String>) {
        let Some(handler) = self.on_progress else {
            return;
        };
        unsafe {
            (*handler)(TransferProgressUpdate {
                processed: processed_roots.min(self.total_roots),
                total: self.total_roots,
                current_path,
                current_bytes: None,
                current_total_bytes: None,
                progress_percent: None,
                status_text: None,
                rate_text: None,
            });
        }
    }

    fn emit_started(&mut self, current_path: Option<String>) {
        self.current_path = current_path.clone();
        self.emit_progress(self.processed_roots, current_path);
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
}

#[implement(IFileOperationProgressSink)]
struct ShellTransferProgressSink {
    state: Arc<Mutex<ShellTransferState>>,
    mode: ShellTransferMode,
}

impl ShellTransferProgressSink {
    fn shell_item_path(item: windows::core::Ref<'_, IShellItem>) -> Option<String> {
        let shell_item = item.as_ref()?;
        read_shell_item_path(shell_item)
    }
}

impl IFileOperationProgressSink_Impl for ShellTransferProgressSink_Impl {
    fn StartOperations(&self) -> WinResult<()> {
        let mut state = self.state.lock().expect("shell transfer progress lock");
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
        psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
    ) -> WinResult<()> {
        if self.mode != ShellTransferMode::Move {
            return Ok(());
        }
        let mut state = self.state.lock().expect("shell transfer progress lock");
        state.check_control()?;
        let path = ShellTransferProgressSink::shell_item_path(psiitem)
            .or_else(|| Some(state.root_path.clone()));
        state.emit_started(path);
        Ok(())
    }

    fn PostMoveItem(
        &self,
        _dwflags: u32,
        psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
        hrmove: HRESULT,
        _psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
        if self.mode != ShellTransferMode::Move {
            return Ok(());
        }
        let mut state = self.state.lock().expect("shell transfer progress lock");
        let path = ShellTransferProgressSink::shell_item_path(psiitem)
            .or_else(|| Some(state.root_path.clone()));
        if hrmove.is_err() && state.failure.is_none() {
            state.failure = Some(WinError::from_hresult(hrmove).to_string());
        }
        state.current_path = path;
        Ok(())
    }

    fn PreCopyItem(
        &self,
        _dwflags: u32,
        psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
    ) -> WinResult<()> {
        if self.mode != ShellTransferMode::Copy {
            return Ok(());
        }
        let mut state = self.state.lock().expect("shell transfer progress lock");
        state.check_control()?;
        let path = ShellTransferProgressSink::shell_item_path(psiitem)
            .or_else(|| Some(state.root_path.clone()));
        state.emit_started(path);
        Ok(())
    }

    fn PostCopyItem(
        &self,
        _dwflags: u32,
        psiitem: windows::core::Ref<'_, IShellItem>,
        _psidestinationfolder: windows::core::Ref<'_, IShellItem>,
        _psznewname: &PCWSTR,
        hrcopy: HRESULT,
        _psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
        if self.mode != ShellTransferMode::Copy {
            return Ok(());
        }
        let mut state = self.state.lock().expect("shell transfer progress lock");
        let path = ShellTransferProgressSink::shell_item_path(psiitem)
            .or_else(|| Some(state.root_path.clone()));
        if hrcopy.is_err() && state.failure.is_none() {
            state.failure = Some(WinError::from_hresult(hrcopy).to_string());
        }
        state.current_path = path;
        Ok(())
    }

    fn PreDeleteItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
        Ok(())
    }

    fn PostDeleteItem(
        &self,
        _dwflags: u32,
        _psiitem: windows::core::Ref<'_, IShellItem>,
        _hrdelete: HRESULT,
        _psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
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
        let mut state = self.state.lock().expect("shell transfer progress lock");
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

pub(crate) fn shell_transfer_entry(
    source: &Path,
    destination: &Path,
    mode: ShellTransferMode,
    processed_roots: usize,
    total_roots: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    let _com = StaComGuard::new()?;
    let file_operation = create_file_operation()?;
    unsafe {
        file_operation
            .SetOwnerWindow(HWND::default())
            .map_err(|err| err.to_string())?;
        file_operation
            .SetOperationFlags(file_operation_flags(mode))
            .map_err(|err| err.to_string())?;
    }

    let source_item = shell_item_from_path(source)?;
    let destination_parent = destination
        .parent()
        .ok_or_else(|| "Destination parent folder unavailable".to_string())?;
    let destination_folder = shell_item_from_path(destination_parent)?;
    let destination_name = destination
        .file_name()
        .ok_or_else(|| "Destination name unavailable".to_string())?;
    let destination_name_wide = to_pcwstr(destination_name);

    let progress_ptr = on_progress
        .as_deref_mut()
        .map(|handler| handler as *mut TransferProgressCallback);
    let control_ptr = on_control
        .as_deref_mut()
        .map(|handler| handler as *mut TransferControlCallback);
    let state = Arc::new(Mutex::new(ShellTransferState {
        processed_roots,
        total_roots,
        root_path: source.to_string_lossy().to_string(),
        current_path: None,
        failure: None,
        on_progress: progress_ptr,
        on_control: control_ptr,
        aborted: false,
    }));
    let sink: IFileOperationProgressSink = ShellTransferProgressSink {
        state: Arc::clone(&state),
        mode,
    }
    .into();
    let cookie = unsafe { file_operation.Advise(&sink) }.map_err(|err| err.to_string())?;

    let queue_result = match mode {
        ShellTransferMode::Move => unsafe {
            file_operation.MoveItem(
                &source_item,
                &destination_folder,
                PCWSTR(destination_name_wide.as_ptr()),
                None::<&IFileOperationProgressSink>,
            )
        },
        ShellTransferMode::Copy => unsafe {
            file_operation.CopyItem(
                &source_item,
                &destination_folder,
                PCWSTR(destination_name_wide.as_ptr()),
                None::<&IFileOperationProgressSink>,
            )
        },
    };
    if let Err(error) = queue_result {
        let _ = unsafe { file_operation.Unadvise(cookie) };
        return Err(error.to_string());
    }

    let perform_error = unsafe { file_operation.PerformOperations() }.err();
    let any_aborted = unsafe { file_operation.GetAnyOperationsAborted() }
        .map(|value| value.as_bool())
        .unwrap_or(false);
    let _ = unsafe { file_operation.Unadvise(cookie) };

    let mut state = state
        .lock()
        .map_err(|_| "shell transfer progress lock".to_string())?;
    if let Some(failure) = state.failure.take() {
        return Err(failure);
    }
    if state.aborted || any_aborted {
        return Err(TRANSFER_CANCELLED_MESSAGE.to_string());
    }
    if let Some(error) = perform_error {
        if error.code() == E_ABORT {
            return Err(TRANSFER_CANCELLED_MESSAGE.to_string());
        }
        return Err(error.to_string());
    }

    Ok(())
}

fn create_file_operation() -> Result<IFileOperation, String> {
    unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_ALL) }.map_err(|err| err.to_string())
}

fn file_operation_flags(mode: ShellTransferMode) -> FILEOPERATION_FLAGS {
    let mut flags = FOF_SILENT | FOF_NOCONFIRMATION | FOF_NOCONFIRMMKDIR | FOF_NOERRORUI;
    if matches!(mode, ShellTransferMode::Move) {
        // Ask the shell to record an undo entry so native move behavior stays aligned
        // with normal Explorer-style operations.
        flags |= FOF_ALLOWUNDO | FOFX_ADDUNDORECORD;
    }
    flags
}

fn shell_item_from_path(path: &Path) -> Result<IShellItem, String> {
    let wide = to_pcwstr(path.as_os_str());
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

fn to_pcwstr(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(once(0)).collect()
}
