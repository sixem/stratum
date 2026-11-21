// Windows OLE drag source. Preparation runs on a worker, the gesture on the window STA.
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DragOutcome {
    Copy,
    Move,
    Link,
    None,
}

#[cfg(target_os = "windows")]
mod payload;
#[cfg(target_os = "windows")]
pub(crate) use payload::prepare_drag;

#[cfg(target_os = "windows")]
mod source {
    use super::{payload::PreparedDrag, DragOutcome};
    use std::cell::Cell;
    use std::sync::atomic::{AtomicU64, Ordering};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Ole::{
        IDropSource, OleInitialize, OleUninitialize, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK,
        DROPEFFECT_MOVE,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    use windows::Win32::UI::Shell::SHDoDragDrop;
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};

    #[derive(Clone, Copy)]
    enum ActiveDrag {
        Entries,
        Folder,
    }

    thread_local! { static ACTIVE: Cell<Option<ActiveDrag>> = const { Cell::new(None) }; }

    // A cancel can reach the IPC worker before the corresponding start.
    // IDs increase for each gesture and never cancel an active OLE drag.
    static CANCELED_THROUGH: AtomicU64 = AtomicU64::new(0);

    pub(crate) fn cancel_drag_start(id: u64) {
        CANCELED_THROUGH.fetch_max(id, Ordering::SeqCst);
    }

    pub(crate) fn start_was_canceled(id: Option<u64>) -> bool {
        id.is_some_and(|id| id <= CANCELED_THROUGH.load(Ordering::SeqCst))
    }

    pub(crate) fn is_stratum_drag_active() -> bool {
        ACTIVE.get().is_some()
    }

    pub(crate) fn can_open_folder_tab() -> bool {
        // The in-process drop target can recognize this source without opening the data object on hover.
        matches!(ACTIVE.get(), Some(ActiveDrag::Folder))
    }

    struct DragGuard;
    impl Drop for DragGuard {
        fn drop(&mut self) {
            ACTIVE.set(None);
            unsafe { OleUninitialize() };
        }
    }

    // Some application windows only accept links (opening or referencing a file).
    pub(crate) const DRAG_EFFECTS: DROPEFFECT =
        DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_MOVE.0 | DROPEFFECT_LINK.0);

    pub(crate) fn start_drag(
        prepared: PreparedDrag,
        hwnd: Option<HWND>,
        id: Option<u64>,
        single_folder: bool,
    ) -> Result<DragOutcome, String> {
        if is_stratum_drag_active() || start_was_canceled(id) {
            return Ok(DragOutcome::None);
        }
        unsafe { OleInitialize(None) }.map_err(|err| err.to_string())?;
        let _guard = DragGuard;
        let data = prepared.data_object()?;
        // The user may have released the primary button while a slow share resolved.
        // GetAsyncKeyState reports physical buttons even with swapped handedness.
        let primary = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 {
            VK_RBUTTON
        } else {
            VK_LBUTTON
        };
        if start_was_canceled(id) || unsafe { GetAsyncKeyState(primary.0.into()) } >= 0 {
            return Ok(DragOutcome::None);
        }
        ACTIVE.set(Some(if single_folder {
            ActiveDrag::Folder
        } else {
            ActiveDrag::Entries
        }));
        // The Shell supplies its standard drop source, cursors and drag image.
        let effect = unsafe { SHDoDragDrop(hwnd, &data, None::<&IDropSource>, DRAG_EFFECTS) }
            .map_err(|err| err.to_string())?;
        Ok(outcome_from_effect(effect))
    }

    pub(super) fn outcome_from_effect(effect: DROPEFFECT) -> DragOutcome {
        if effect.0 & DROPEFFECT_MOVE.0 != 0 {
            DragOutcome::Move
        } else if effect.0 & DROPEFFECT_COPY.0 != 0 {
            DragOutcome::Copy
        } else if effect.0 & DROPEFFECT_LINK.0 != 0 {
            DragOutcome::Link
        } else {
            DragOutcome::None
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) use source::{
    can_open_folder_tab, cancel_drag_start, is_stratum_drag_active, start_drag, start_was_canceled,
};

#[cfg(all(target_os = "windows", test))]
mod tests;
