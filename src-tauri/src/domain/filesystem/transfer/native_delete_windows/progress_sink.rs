// IFileOperation progress sink used by the Windows shell delete backend.
// This module owns callback bridging and root-level failure reconciliation so
// the public entrypoint can focus on queueing and final reporting.
use super::shell_items::read_shell_item_path;
use crate::domain::filesystem::fs_recycle_windows::{
    recycle_source_identity, FileIdentity, MAX_RECYCLED_ITEMS,
};
use crate::domain::filesystem::transfer::common::{
    entry_kind_for_transfer_kind, inspect_path, EntryKind,
};
use crate::domain::filesystem::RemovedRoot;
use crate::domain::filesystem::{
    CompletedTransferItem, TransferControlCallback, TransferProgressCallback,
    TransferProgressUpdate,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use windows::core::{implement, Error as WinError, PCWSTR};
use windows::Win32::Foundation::{E_ABORT, S_OK};
use windows::Win32::UI::Shell::{
    IFileOperationProgressSink, IFileOperationProgressSink_Impl, IShellItem,
    COPYENGINE_S_DONT_PROCESS_CHILDREN, COPYENGINE_S_NOT_HANDLED, COPYENGINE_S_PENDING_DELETE,
};
use windows_core::{Result as WinResult, HRESULT};

pub(super) struct DeletePost {
    pub removed: RemovedRoot,
    pub source_removed_at_post: bool,
}

pub(super) struct SelectedRoot {
    pub path: String,
    pub kind: Option<EntryKind>,
    pub processed: bool,
}

pub(super) struct DeleteOperationState {
    pub total_items: usize,
    pub processed_items: usize,
    pub current_path: Option<String>,
    pub on_progress: Option<*mut TransferProgressCallback>,
    pub on_control: Option<*mut TransferControlCallback>,
    // Key by the Shell's spelling, but report the path originally selected in Work.
    pub roots: HashMap<PathBuf, SelectedRoot>,
    // Shell can post a folder result before releasing its last handle.
    pub successful_posts: Vec<DeletePost>,
    pub root_failures: HashMap<String, String>,
    pub recycle_source_ids: Option<HashMap<String, FileIdentity>>,
    pub recycled_items: Vec<RecycledItem>,
    pub aborted: bool,
}

pub(super) struct RecycledItem {
    pub original_path: String,
    pub shell_path: String,
    pub identity: FileIdentity,
}

impl DeleteOperationState {
    fn emit_progress(
        &mut self,
        current_path: Option<String>,
        completed_item: Option<CompletedTransferItem>,
    ) {
        let Some(handler) = self.on_progress else {
            return;
        };
        unsafe {
            (*handler)(TransferProgressUpdate {
                processed: self.processed_items.min(self.total_items),
                total: self.total_items,
                current_path,
                completed_item,
                ..Default::default()
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

    pub(super) fn mark_processed(
        &mut self,
        current_path: Option<String>,
        succeeded: bool,
        recycled: Option<bool>,
    ) {
        self.processed_items = self.processed_items.saturating_add(1).min(self.total_items);
        // The Shell may report descendant items as well as the selected root.
        // Release the selected path once, and confirm it actually disappeared.
        let completed_item = current_path
            .as_ref()
            .and_then(|path| {
                self.roots
                    .get_mut(Path::new(path))
                    .filter(|root| !root.processed)
            })
            .map(|root| {
                root.processed = true;
                let path = root.path.clone();
                let source_removed = succeeded
                    && std::fs::symlink_metadata(&path)
                        .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound);
                if let (Some(kind), Some(recycled)) = (root.kind, recycled) {
                    self.successful_posts.push(DeletePost {
                        removed: RemovedRoot {
                            path: path.clone(),
                            kind,
                            recycled,
                        },
                        source_removed_at_post: source_removed || recycled,
                    });
                }
                CompletedTransferItem {
                    path,
                    source_removed,
                }
            });
        self.emit_progress(current_path, completed_item);
    }

    fn root_for_path(&self, path: &str) -> Option<String> {
        Path::new(path)
            .ancestors()
            .find_map(|parent| self.roots.get(parent))
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
        if let Some(path) = path.as_deref() {
            let path = Path::new(path);
            if let Some(root) = state.roots.get_mut(path) {
                root.kind = inspect_path(path)
                    .ok()
                    .map(|item| entry_kind_for_transfer_kind(item.kind));
            }
        }
        if let (Some(ids), Some(path)) = (state.recycle_source_ids.as_mut(), path.as_ref()) {
            if ids.len() < MAX_RECYCLED_ITEMS {
                if let Ok(identity) = recycle_source_identity(Path::new(path)) {
                    ids.insert(path.clone(), identity);
                }
            }
        }
        state.current_path = path.clone();
        state.emit_progress(path, None);
        Ok(())
    }

    fn PostDeleteItem(
        &self,
        _dwflags: u32,
        psiitem: windows::core::Ref<'_, IShellItem>,
        hrdelete: HRESULT,
        psinewlycreated: windows::core::Ref<'_, IShellItem>,
    ) -> WinResult<()> {
        let mut state = self.state.lock().expect("delete progress lock");
        let path = ShellDeleteProgressSink::shell_item_path(psiitem);
        let recycled = psinewlycreated.as_ref().is_some();
        let identity = path
            .as_ref()
            .and_then(|path| state.recycle_source_ids.as_mut()?.remove(path));
        if hrdelete.is_err() {
            state.record_failure(path.as_deref(), hrdelete);
        } else if state.recycled_items.len() < MAX_RECYCLED_ITEMS {
            // A new Shell item identifies the physical Recycle Bin entry from this operation.
            if let (Some(identity), Some(original_path), Some(shell_path)) = (
                identity,
                path.as_ref()
                    .filter(|path| state.root_for_path(path).is_some()),
                ShellDeleteProgressSink::shell_item_path(psinewlycreated),
            ) {
                state.recycled_items.push(RecycledItem {
                    original_path: original_path.clone(),
                    shell_path,
                    identity,
                });
            }
        }
        // A folder can post NOT_HANDLED before the Shell processes its children.
        // Reconcile these posts after PerformOperations, when the folder can disappear.
        let confirmed = matches!(
            hrdelete,
            S_OK | COPYENGINE_S_DONT_PROCESS_CHILDREN | COPYENGINE_S_PENDING_DELETE
        ) || (hrdelete == COPYENGINE_S_NOT_HANDLED
            && path
                .as_ref()
                .and_then(|p| state.roots.get(Path::new(p)))
                .and_then(|r| r.kind)
                == Some(EntryKind::Directory));
        state.mark_processed(path, hrdelete.is_ok(), confirmed.then_some(recycled));
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
