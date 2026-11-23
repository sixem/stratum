// Acquire external files ahead of the managed transfer and deliver them to the receiving WebView.
use super::staging::{prepare_hdrop_paths, PinnedDrop, PreparedHdrop};
use super::{
    extract_drop_paths_for_transfer, extract_hdrop_paths, materialize_virtual_drop,
    stage_slots::StageSlot, staged_path_spelling_supported, DragPosition, DropAction,
    DropDataError, FileDrag, IncomingDrops, ReceivedFiles, StageSlots,
};
use crate::platform::windows::com::StaComGuard;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, EventTarget, Manager};
use windows::core::{AgileReference, Interface};
use windows::Win32::Foundation::{E_FAIL, S_OK};
use windows::Win32::System::Com::{IBindCtx, IDataObject};
use windows::Win32::System::Ole::{DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::IDataObjectAsyncCapability;

#[cfg(test)]
mod tests;

static NEXT_RECEIVE_ID: AtomicU64 = AtomicU64::new(1);
const COPY_REQUIRED: &str =
    "This source provides temporary copies. Drag without Shift to copy them.";

pub(super) fn emit(app: &AppHandle, label: &str, event: FileDrag) -> bool {
    app.emit_to(EventTarget::webview(label), "stratum-file-drag", event)
        .is_ok()
}

pub(super) struct DropDelivery {
    pub(super) app: AppHandle,
    pub(super) label: String,
    pub(super) generation: u64,
    pub(super) position: DragPosition,
    pub(super) allowed: DROPEFFECT,
    pub(super) keys: MODIFIERKEYS_FLAGS,
    pub(super) can_open_folder_tab: bool,
}

impl DropDelivery {
    pub(super) fn receive_external(self, data: &IDataObject) -> DROPEFFECT {
        let incoming = self.app.state::<IncomingDrops>();
        let can_copy = DropAction::choose(self.allowed, self.keys, false).is_some();
        if can_copy {
            match AsyncDrop::start(data, &incoming.async_slots) {
                Ok(Some(source)) => return self.receive(ReceiveSource::Async(source)),
                Ok(None) => {}
                Err(error) => return self.fail(error.message(), None),
            }
        }

        let paths = extract_hdrop_paths(data);
        if paths.is_empty() {
            return self.finish(
                materialize_virtual_drop(data, &incoming.staging_slots),
                None,
            );
        }
        match prepare_hdrop_paths(paths, &incoming.staging_slots) {
            Ok(PreparedHdrop::Direct(paths)) => self.finish(Ok(ReceivedFiles::direct(paths)), None),
            Ok(PreparedHdrop::Temporary(source)) if can_copy => {
                self.receive(ReceiveSource::Pinned(source))
            }
            Ok(PreparedHdrop::Temporary(_)) => self.fail(COPY_REQUIRED, None),
            Err(error) => self.fail(error.message(), None),
        }
    }

    fn receive(self, source: ReceiveSource) -> DROPEFFECT {
        let id = NEXT_RECEIVE_ID.fetch_add(1, Ordering::Relaxed);
        if !self.is_current()
            || !self.emit(FileDrag::Receiving {
                position: self.position,
                pending_drop: id,
            })
        {
            if let ReceiveSource::Async(source) = source {
                source.end(DROPEFFECT_NONE);
            }
            return DROPEFFECT_NONE;
        }

        // The destination is captured by the Receiving event before any data is copied.
        drop(tauri::async_runtime::spawn_blocking(move || match source {
            ReceiveSource::Pinned(source) => {
                let result = if self.is_current() {
                    source.materialize()
                } else {
                    return;
                };
                self.finish(result, Some(id));
            }
            ReceiveSource::Async(source) => source.deliver(self, id),
        }));
        DROPEFFECT_COPY
    }

    fn is_current(&self) -> bool {
        self.app.state::<IncomingDrops>().generation(&self.label) == Some(self.generation)
    }

    fn emit(&self, event: FileDrag) -> bool {
        emit(&self.app, &self.label, event)
    }

    fn fail(&self, message: &'static str, pending_drop: Option<u64>) -> DROPEFFECT {
        if self.is_current() {
            self.emit(FileDrag::Error {
                message,
                pending_drop,
            });
        }
        DROPEFFECT_NONE
    }

    pub(super) fn finish(
        &self,
        result: Result<ReceivedFiles, DropDataError>,
        pending_drop: Option<u64>,
    ) -> DROPEFFECT {
        if !self.is_current() {
            return DROPEFFECT_NONE;
        }
        let files = match result {
            Ok(files) => files,
            Err(error) => return self.fail(error.message(), pending_drop),
        };
        if files.stage.is_some()
            && !files
                .paths
                .iter()
                .all(|path| staged_path_spelling_supported(path))
        {
            return self.fail("A temporary drop contains a file or folder name that ends in whitespace. Rename it and try again.", pending_drop);
        }
        let Some(mode) = DropAction::choose(self.allowed, self.keys, files.stage.is_none()) else {
            return self.fail(COPY_REQUIRED, pending_drop);
        };
        let incoming = self.app.state::<IncomingDrops>();
        let stage = match files.stage {
            Some(stage) => {
                let Some(id) = incoming.retain(&self.label, self.generation, stage, &files.paths)
                else {
                    return DROPEFFECT_NONE;
                };
                Some(id)
            }
            None => None,
        };
        if self.emit(FileDrag::Drop {
            paths: files.paths,
            position: self.position,
            mode,
            stage,
            can_open_folder_tab: self.can_open_folder_tab,
            pending_drop,
        }) {
            return mode.completion_effect();
        }
        if let Some(id) = stage {
            incoming.release(&self.label, id);
        }
        DROPEFFECT_NONE
    }
}

enum ReceiveSource {
    Pinned(PinnedDrop),
    Async(AsyncDrop),
}

struct AsyncDrop {
    data: AgileReference<IDataObject>,
    _slot: StageSlot,
}

impl AsyncDrop {
    fn start(data: &IDataObject, slots: &StageSlots) -> Result<Option<Self>, DropDataError> {
        let Ok(operation) = data.cast::<IDataObjectAsyncCapability>() else {
            return Ok(None);
        };
        if !unsafe { operation.GetAsyncMode() }.is_ok_and(|enabled| enabled.as_bool()) {
            return Ok(None);
        }
        let Ok(data) = AgileReference::new(data) else {
            return Ok(None);
        };
        let slot = slots.reserve()?;
        if unsafe { operation.StartOperation(None::<&IBindCtx>) }.is_err() {
            return Ok(None);
        }
        Ok(Some(Self { data, _slot: slot }))
    }

    fn deliver(self, delivery: DropDelivery, id: u64) {
        let effect = if delivery.is_current() {
            let incoming = delivery.app.state::<IncomingDrops>();
            delivery.finish(self.extract(&incoming.staging_slots), Some(id))
        } else {
            DROPEFFECT_NONE
        };
        // Some providers marshal IDataObject but keep their async control on
        // the original apartment. End the operation there after taking the data.
        let _ = delivery.app.run_on_main_thread(move || self.end(effect));
    }

    fn extract(&self, slots: &StageSlots) -> Result<ReceivedFiles, DropDataError> {
        let _apartment = StaComGuard::new().map_err(|_| DropDataError::InvalidSource)?;
        let data = self
            .data
            .resolve()
            .map_err(|_| DropDataError::InvalidSource)?;
        extract_drop_paths_for_transfer(&data, false, slots)
    }

    fn end(self, effect: DROPEFFECT) {
        if let Ok(operation) = self
            .data
            .resolve()
            .and_then(|data| data.cast::<IDataObjectAsyncCapability>())
        {
            let status = if effect == DROPEFFECT_NONE {
                E_FAIL
            } else {
                S_OK
            };
            // Let the source release its temp files once Stratum owns the data.
            let _ = unsafe { operation.EndOperation(status, None::<&IBindCtx>, effect.0) };
        }
    }
}
