// IFileOperation progress sink used by the Windows shell delete backend.
// This module owns callback bridging and root-level failure reconciliation so
// the public entrypoint can focus on queueing and final reporting.
use super::shell_items::read_shell_item_path;
use crate::domain::filesystem::transfer::common::path_is_same_or_within;
use crate::domain::filesystem::transfer::delete_discovery::DeleteDiscoveryRoot;
use crate::domain::filesystem::{
    TransferControlCallback, TransferProgressCallback, TransferProgressUpdate,
};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use windows::core::{implement, Error as WinError, PCWSTR};
use windows::Win32::Foundation::E_ABORT;
use windows::Win32::UI::Shell::{
    IFileOperationProgressSink, IFileOperationProgressSink_Impl, IShellItem,
};
use windows_core::{HRESULT, Result as WinResult};

pub(super) struct DeleteOperationState {
    pub total_items: usize,
    pub processed_items: usize,
    pub current_path: Option<String>,
    pub on_progress: Option<*mut TransferProgressCallback>,
    pub on_control: Option<*mut TransferControlCallback>,
    pub roots: Vec<DeleteDiscoveryRoot>,
    pub root_failures: HashMap<String, String>,
    pub aborted: bool,
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

pub(super) fn create_progress_sink(
    state: Arc<Mutex<DeleteOperationState>>,
) -> IFileOperationProgressSink {
    ShellDeleteProgressSink { state }.into()
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
