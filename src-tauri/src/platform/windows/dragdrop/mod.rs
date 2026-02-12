// Windows-only drop target implementation.
// Owns COM registration and translates drag-drop into Tauri events.
use serde::Serialize;
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use tauri::{AppHandle, Emitter, EventTarget, Manager};

use windows::core::{implement, Result as WinResult, BOOL};
use windows::Win32::Foundation::{
    DRAGDROP_E_INVALIDHWND, HWND, LPARAM, POINT, POINTL, RPC_E_CHANGED_MODE,
};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Com::IDataObject;
use windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, OleInitialize, RegisterDragDrop, RevokeDragDrop, DROPEFFECT,
    DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE, DROPEFFECT_NONE,
};
use windows::Win32::System::SystemServices::{MK_CONTROL, MK_SHIFT, MODIFIERKEYS_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

mod data;
mod shell;
mod staging;

use data::{extract_hdrop_paths, materialize_virtual_paths, supports_drop};
use shell::materialize_shell_id_list_paths;
use staging::stage_temp_hdrop_paths;

const DRAG_ENTER_EVENT: &str = "tauri://drag-enter";
const DRAG_OVER_EVENT: &str = "tauri://drag-over";
const DRAG_DROP_EVENT: &str = "tauri://drag-drop";
const DRAG_LEAVE_EVENT: &str = "tauri://drag-leave";

fn extract_drop_paths_for_transfer(data: &IDataObject) -> Vec<String> {
    // Keep drop extraction layered and easy to extend:
    // 1) Regular filesystem drops via CF_HDROP paths (with extra staging for temp sources).
    // 2) Virtual files (7-Zip etc.) via FileGroupDescriptor + FileContents.
    // 3) Shell namespace drops (WinSCP etc.) via Shell IDList Array, copied into temp.
    //
    // Rationale: many real filesystem drags (Explorer) also expose shell/virtual formats. Trying
    // CF_HDROP first avoids unnecessary materialization of already-stable files.

    let hdrop_paths = extract_hdrop_paths(data);
    if !hdrop_paths.is_empty() {
        return stage_temp_hdrop_paths(&hdrop_paths).unwrap_or(hdrop_paths);
    }

    let virtual_paths = materialize_virtual_paths(data);
    if !virtual_paths.is_empty() {
        return virtual_paths;
    }

    materialize_shell_id_list_paths(data)
}

thread_local! {
    // Keep drop targets alive on the registering thread (COM apartment).
    static DROP_TARGETS: RefCell<HashMap<String, Vec<IDropTarget>>> =
        RefCell::new(HashMap::new());
}

// --- Registration helpers -------------------------------------------------

#[derive(Serialize, Clone, Copy)]
struct DragPosition {
    x: i32,
    y: i32,
}

#[derive(Serialize, Clone)]
struct DragEnterPayload {
    paths: Vec<String>,
    position: DragPosition,
}

#[derive(Serialize, Clone)]
struct DragOverPayload {
    position: DragPosition,
}

#[derive(Serialize, Clone)]
struct DragDropPayload {
    paths: Vec<String>,
    position: DragPosition,
}

// Installs custom drop targets for the WebView2 child HWND(s).
pub fn register_drop_target(window: tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|err| err.to_string())?;
    let app = window.app_handle().clone();
    let label = window.label().to_string();

    let init = unsafe { OleInitialize(None) };
    if let Err(err) = init {
        if err.code() != RPC_E_CHANGED_MODE {
            return Err(err.to_string());
        }
    }

    let targets = collect_drop_targets(hwnd, app, &label);
    if targets.is_empty() {
        return Err("No HWND targets registered for drop handler".to_string());
    }

    store_drop_targets(&label, targets);
    Ok(())
}

#[implement(IDropTarget)]
struct DropTarget {
    hwnd: HWND,
    app: AppHandle,
    label: String,
    supported: AtomicBool,
    allowed_effects: AtomicU32,
}

impl DropTarget {
    fn emit_event<T: Serialize + Clone>(&self, event: &str, payload: T) {
        let target = EventTarget::webview(self.label.as_str());
        let _ = self.app.emit_to(target, event, payload);
    }

    fn position(&self, pt: &POINTL) -> DragPosition {
        let mut point = POINT { x: pt.x, y: pt.y };
        let converted = unsafe { ScreenToClient(self.hwnd, &mut point) }.as_bool();
        if converted {
            DragPosition {
                x: point.x,
                y: point.y,
            }
        } else {
            DragPosition { x: pt.x, y: pt.y }
        }
    }
}

fn store_drop_targets(label: &str, targets: Vec<IDropTarget>) {
    DROP_TARGETS.with(|targets_map| {
        targets_map.borrow_mut().insert(label.to_string(), targets);
    });
}

fn collect_drop_targets(parent_hwnd: HWND, app: AppHandle, label: &str) -> Vec<IDropTarget> {
    let mut targets = Vec::new();
    for child in enumerate_child_hwnds(parent_hwnd) {
        if let Some(target) = register_on_hwnd(child, app.clone(), label) {
            targets.push(target);
        }
    }

    if targets.is_empty() {
        if let Some(target) = register_on_hwnd(parent_hwnd, app, label) {
            targets.push(target);
        }
    }

    targets
}

fn enumerate_child_hwnds(parent_hwnd: HWND) -> Vec<HWND> {
    let mut handles: Vec<HWND> = Vec::new();

    // Safe because EnumChildWindows is synchronous and we keep the Vec alive
    // for the duration of the call.
    unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let handles = &mut *(lparam.0 as *mut Vec<HWND>);
        handles.push(hwnd);
        BOOL(1)
    }

    let lparam = LPARAM(&mut handles as *mut _ as isize);
    let _ = unsafe { EnumChildWindows(Some(parent_hwnd), Some(enum_callback), lparam) };
    handles
}

fn register_on_hwnd(hwnd: HWND, app: AppHandle, label: &str) -> Option<IDropTarget> {
    let target: IDropTarget = DropTarget {
        hwnd,
        app,
        label: label.to_string(),
        supported: AtomicBool::new(false),
        // Atomic storage uses the raw integer representation of the drop mask.
        allowed_effects: AtomicU32::new(DROPEFFECT_NONE.0),
    }
    .into();

    if unsafe { RevokeDragDrop(hwnd) } == Err(DRAGDROP_E_INVALIDHWND.into()) {
        return None;
    }

    unsafe { RegisterDragDrop(hwnd, &target) }.ok()?;
    Some(target)
}

impl IDropTarget_Impl for DropTarget_Impl {
    fn DragEnter(
        &self,
        pdataobj: windows::core::Ref<'_, IDataObject>,
        grfkeystate: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        let data = pdataobj.as_ref();
        let supported = data.map_or(false, supports_drop);
        self.supported.store(supported, Ordering::Relaxed);
        let allowed_mask = read_effect_mask(pdweffect);
        self.allowed_effects
            .store(allowed_mask.0, Ordering::Relaxed);
        set_drop_effect(pdweffect, grfkeystate, supported, allowed_mask);
        if supported {
            let paths = data.map(extract_hdrop_paths).unwrap_or_default();
            self.emit_event(
                DRAG_ENTER_EVENT,
                DragEnterPayload {
                    paths,
                    position: self.position(pt),
                },
            );
        }
        Ok(())
    }

    fn DragOver(
        &self,
        grfkeystate: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        let supported = self.supported.load(Ordering::Relaxed);
        let allowed_mask = DROPEFFECT(self.allowed_effects.load(Ordering::Relaxed));
        set_drop_effect(pdweffect, grfkeystate, supported, allowed_mask);
        if supported {
            self.emit_event(
                DRAG_OVER_EVENT,
                DragOverPayload {
                    position: self.position(pt),
                },
            );
        }
        Ok(())
    }

    fn DragLeave(&self) -> WinResult<()> {
        let was_supported = self.supported.swap(false, Ordering::Relaxed);
        if was_supported {
            self.emit_event(DRAG_LEAVE_EVENT, ());
        }
        Ok(())
    }

    fn Drop(
        &self,
        pdataobj: windows::core::Ref<'_, IDataObject>,
        grfkeystate: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        let Some(data) = pdataobj.as_ref() else {
            let allowed_mask = read_effect_mask(pdweffect);
            set_drop_effect(pdweffect, grfkeystate, false, allowed_mask);
            return Ok(());
        };

        let paths = extract_drop_paths_for_transfer(data);
        let supported = !paths.is_empty();
        self.supported.store(false, Ordering::Relaxed);
        let allowed_mask = DROPEFFECT(self.allowed_effects.load(Ordering::Relaxed));
        set_drop_effect(pdweffect, grfkeystate, supported, allowed_mask);
        if supported {
            self.emit_event(
                DRAG_DROP_EVENT,
                DragDropPayload {
                    paths,
                    position: self.position(pt),
                },
            );
        }
        Ok(())
    }
}

// --- Drop data inspection ------------------------------------------------

fn set_drop_effect(
    pdweffect: *mut DROPEFFECT,
    grfkeystate: MODIFIERKEYS_FLAGS,
    supported: bool,
    allowed_mask: DROPEFFECT,
) {
    if pdweffect.is_null() {
        return;
    }

    let allowed = allowed_mask;
    let allow_copy = (allowed & DROPEFFECT_COPY) == DROPEFFECT_COPY;
    let allow_move = (allowed & DROPEFFECT_MOVE) == DROPEFFECT_MOVE;

    // The source cursor might keep link-only drops alive; we fall back to the mask if neither
    // copy nor move is allowed rather than forcing NONE immediately.
    let allow_link = (allowed & DROPEFFECT_LINK) == DROPEFFECT_LINK;

    let effect = if supported {
        let prefers_move = (grfkeystate & MK_SHIFT).0 != 0;
        let prefers_copy = (grfkeystate & MK_CONTROL).0 != 0;
        if prefers_move && !prefers_copy && allow_move {
            DROPEFFECT_MOVE
        } else if prefers_copy && allow_copy {
            DROPEFFECT_COPY
        } else if allow_copy {
            DROPEFFECT_COPY
        } else if allow_move {
            DROPEFFECT_MOVE
        } else if allow_link {
            DROPEFFECT_LINK
        } else {
            DROPEFFECT_NONE
        }
    } else {
        DROPEFFECT_NONE
    };
    unsafe {
        *pdweffect = effect;
    }
}

fn read_effect_mask(pdweffect: *const DROPEFFECT) -> DROPEFFECT {
    if pdweffect.is_null() {
        return DROPEFFECT_NONE;
    }
    unsafe { *pdweffect }
}
