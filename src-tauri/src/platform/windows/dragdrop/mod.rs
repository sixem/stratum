// Receives Windows OLE drags and forwards one ordered event stream to the file view.
use serde::Serialize;
use std::cell::Cell;
use tauri::{AppHandle, Emitter, EventTarget, Manager};
use windows::core::{implement, Ref, Result as WinResult};
use windows::Win32::Foundation::{HWND, POINT, POINTL};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Com::IDataObject;
use windows::Win32::System::Ole::{IDropTarget, IDropTarget_Impl, DROPEFFECT, DROPEFFECT_NONE};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;

mod data;
mod effects;
mod leases;
mod registration;
mod shell;
mod stage_slots;
mod staging;

pub(crate) use leases::staged_path_spelling_supported;
#[cfg(test)]
pub(crate) use leases::tests::claimed_test_file;
pub use leases::IncomingDrops;
pub use registration::{register_drop_target, unregister_drop_target};
pub(crate) use staging::DropStage;

use crate::platform::drag::is_stratum_drag_active;
use data::{
    extract_hdrop_paths, materialize_virtual_paths, supports_hdrop, supports_virtual_drop,
    DropDataError,
};
use effects::DropAction;

use stage_slots::StageSlots;
use staging::ReceivedFiles;

fn extract_drop_paths_for_transfer(
    data: &IDataObject,
    local: bool,
    slots: &StageSlots,
) -> Result<ReceivedFiles, DropDataError> {
    let paths = extract_hdrop_paths(data);
    if !paths.is_empty() {
        if local {
            return Ok(ReceivedFiles::direct(paths));
        }
        // Some archive programs discard their temporary files as soon as Drop
        // returns. Only direct filesystem paths support moving the originals.
        return staging::stage_temp_hdrop_paths(&paths, slots);
    }
    match materialize_virtual_paths(data, slots)? {
        Some(files) => Ok(files),
        None => shell::materialize_shell_id_list_paths(data, slots),
    }
}

#[derive(Serialize, Clone, Copy)]
struct DragPosition {
    x: i32,
    y: i32,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
enum FileDrag {
    Enter {
        position: DragPosition,
    },
    Over {
        position: DragPosition,
    },
    Leave,
    Drop {
        paths: Vec<String>,
        position: DragPosition,
        mode: DropAction,
        stage: Option<u64>,
    },
    Error {
        message: &'static str,
    },
}

#[implement(IDropTarget)]
struct DropTarget {
    // Every registered child reports coordinates in the same file-view viewport.
    viewport: HWND,
    app: AppHandle,
    label: String,
    supported: Cell<bool>,
    filesystem: Cell<bool>,
    allowed: Cell<DROPEFFECT>,
}

impl DropTarget {
    fn emit(&self, event: FileDrag) -> bool {
        self.app
            .emit_to(
                EventTarget::webview(&self.label),
                "stratum-file-drag",
                event,
            )
            .is_ok()
    }

    fn position(&self, pt: &POINTL) -> Option<DragPosition> {
        let mut point = POINT { x: pt.x, y: pt.y };
        unsafe { ScreenToClient(self.viewport, &mut point) }
            .as_bool()
            .then_some(DragPosition {
                x: point.x,
                y: point.y,
            })
    }

    fn action(&self, keys: MODIFIERKEYS_FLAGS) -> Option<DropAction> {
        if !self.supported.get() {
            return None;
        }
        DropAction::choose(self.allowed.get(), keys, self.filesystem.get())
    }
}

impl IDropTarget_Impl for DropTarget_Impl {
    fn DragEnter(
        &self,
        object: Ref<'_, IDataObject>,
        keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        let Some(effect) = (unsafe { effect.as_mut() }) else {
            return Ok(());
        };
        self.allowed.set(*effect);
        let data = object.as_ref().filter(|_| {
            self.app
                .state::<IncomingDrops>()
                .generation(&self.label)
                .is_some()
        });
        self.filesystem.set(data.is_some_and(supports_hdrop));
        self.supported
            .set(self.filesystem.get() || data.is_some_and(supports_virtual_drop));
        *effect = self
            .action(keys)
            .map_or(DROPEFFECT_NONE, DropAction::hover_effect);
        // Format discovery is enough for hover. GetData can cause the sender
        // to extract an archive or wait on a network share.
        if self.supported.get() {
            if let Some(position) = self.position(pt) {
                self.emit(FileDrag::Enter { position });
            }
        }
        Ok(())
    }

    fn DragOver(
        &self,
        keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        if let Some(effect) = unsafe { effect.as_mut() } {
            *effect = self
                .action(keys)
                .map_or(DROPEFFECT_NONE, DropAction::hover_effect);
        }
        if self.supported.get() {
            if let Some(position) = self.position(pt) {
                self.emit(FileDrag::Over { position });
            }
        }
        Ok(())
    }

    fn DragLeave(&self) -> WinResult<()> {
        if self.supported.replace(false) {
            self.emit(FileDrag::Leave);
        }
        Ok(())
    }

    fn Drop(
        &self,
        object: Ref<'_, IDataObject>,
        keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        let Some(effect) = (unsafe { effect.as_mut() }) else {
            return Ok(());
        };
        *effect = DROPEFFECT_NONE;
        let incoming = self.app.state::<IncomingDrops>();
        let allowed = self.action(keys).is_some();
        self.supported.set(false);
        let (Some(data), Some(position), Some(generation), true) = (
            object.as_ref(),
            self.position(pt),
            incoming.generation(&self.label),
            allowed,
        ) else {
            self.emit(FileDrag::Leave);
            return Ok(());
        };
        let extracted = extract_drop_paths_for_transfer(
            data,
            is_stratum_drag_active(),
            &incoming.staging_slots,
        );
        if incoming.generation(&self.label) != Some(generation) {
            return Ok(());
        }
        let files = match extracted {
            Ok(files) => files,
            Err(error) => {
                self.emit(FileDrag::Error {
                    message: error.message(),
                });
                return Ok(());
            }
        };
        if files.stage.is_some()
            && !files
                .paths
                .iter()
                .all(|path| staged_path_spelling_supported(path))
        {
            self.emit(FileDrag::Error {
                message: "A temporary drop contains a file or folder name that ends in whitespace. Rename it and try again.",
            });
            return Ok(());
        }
        if let Some(mode) = DropAction::choose(self.allowed.get(), keys, files.stage.is_none()) {
            let stage = match files.stage {
                Some(stage) => {
                    let Some(id) = incoming.retain(&self.label, generation, stage, &files.paths)
                    else {
                        return Ok(());
                    };
                    Some(id)
                }
                None => None,
            };
            if self.emit(FileDrag::Drop {
                paths: files.paths,
                position,
                mode,
                stage,
            }) {
                *effect = mode.completion_effect();
            } else if let Some(id) = stage {
                incoming.release(&self.label, id);
            }
        } else {
            self.emit(FileDrag::Error {
                message: "This source provides temporary copies. Drag without Shift to copy them.",
            });
        }
        Ok(())
    }
}
