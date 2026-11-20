// A WebView2 can create or replace child windows after the first Tauri window
// event. Register on page load, then pick up new children when focus returns.
use super::DropTarget;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use tauri::Manager;
use windows::core::BOOL;
use windows::Win32::Foundation::{DRAGDROP_E_ALREADYREGISTERED, HWND, LPARAM};
use windows::Win32::System::Ole::{
    IDropTarget, OleInitialize, OleUninitialize, RegisterDragDrop, RevokeDragDrop, DROPEFFECT_NONE,
};
use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

struct WindowTargets {
    registered: Vec<(HWND, IDropTarget)>,
}

impl WindowTargets {
    fn new() -> windows::core::Result<Self> {
        unsafe {
            OleInitialize(None)?;
        }
        Ok(Self {
            registered: Vec::new(),
        })
    }
    fn update(
        &mut self,
        viewport: HWND,
        page_loaded: bool,
        mut make_target: impl FnMut() -> IDropTarget,
    ) -> Result<(), String> {
        let handles = child_windows(viewport);
        self.registered.retain(|(hwnd, _)| handles.contains(hwnd));
        for hwnd in handles {
            if let Some(index) = self.registered.iter().position(|(known, _)| *known == hwnd) {
                if !page_loaded {
                    continue;
                }
                self.registered.swap_remove(index);
            }
            let target = make_target();
            let mut registered = unsafe { RegisterDragDrop(hwnd, &target) };
            if registered == Err(DRAGDROP_E_ALREADYREGISTERED.into()) {
                // WebView2 may have installed its own target since the last load.
                registered =
                    unsafe { RevokeDragDrop(hwnd).and_then(|()| RegisterDragDrop(hwnd, &target)) };
            }
            if registered.is_ok() {
                self.registered.push((hwnd, target));
            }
        }
        if self.registered.is_empty() {
            return Err("Windows could not register a file drop target".into());
        }
        Ok(())
    }
}

impl Drop for WindowTargets {
    fn drop(&mut self) {
        for (hwnd, _target) in self.registered.drain(..) {
            unsafe {
                let _ = RevokeDragDrop(hwnd);
            }
        }
        unsafe {
            OleUninitialize();
        }
    }
}

thread_local! {
    static WINDOWS: RefCell<HashMap<String, WindowTargets>> = RefCell::new(HashMap::new());
}

fn child_windows(parent: HWND) -> Vec<HWND> {
    let mut handles = vec![parent];
    unsafe extern "system" fn collect(hwnd: HWND, arg: LPARAM) -> BOOL {
        (*(arg.0 as *mut Vec<HWND>)).push(hwnd);
        BOOL(1)
    }
    // EnumChildWindows calls the callback synchronously.
    unsafe {
        let _ = EnumChildWindows(
            Some(parent),
            Some(collect),
            LPARAM(&mut handles as *mut _ as isize),
        );
    }
    handles
}

pub fn register_drop_target(window: &tauri::Window, page_loaded: bool) -> Result<(), String> {
    let viewport = window.hwnd().map_err(|err| err.to_string())?;
    WINDOWS.with_borrow_mut(|windows| {
        let entry = windows.entry(window.label().to_string());
        let state = match entry {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(WindowTargets::new().map_err(|err| err.to_string())?)
            }
        };
        state.update(viewport, page_loaded, || {
            DropTarget {
                viewport,
                app: window.app_handle().clone(),
                label: window.label().to_owned(),
                supported: Cell::new(false),
                filesystem: Cell::new(false),
                allowed: Cell::new(DROPEFFECT_NONE),
            }
            .into()
        })
    })
}

pub fn unregister_drop_target(label: &str) {
    WINDOWS.with_borrow_mut(|windows| windows.remove(label));
}

#[cfg(test)]
mod tests;
