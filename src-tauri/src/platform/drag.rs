// Native drag source for OS-level drag-and-drop.
use serde::Serialize;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(not(target_os = "windows"))]
type HWND = ();

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DragOutcome {
    Copy,
    Move,
    None,
}

pub fn start_drag(paths: Vec<String>, hwnd: Option<HWND>) -> Result<DragOutcome, String> {
    #[cfg(target_os = "windows")]
    {
        return windows_drag::start_drag(paths, hwnd);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (paths, hwnd);
        return Err("Drag is only supported on Windows".to_string());
    }
}

#[cfg(target_os = "windows")]
mod windows_drag {
    use super::DragOutcome;
    use super::HWND;
    use std::collections::HashSet;
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use windows::core::{implement, PCWSTR};
    use windows::Win32::Foundation::{
        DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, S_OK,
    };
    use windows::Win32::System::Com::{CoTaskMemFree, IDataObject};
    use windows::Win32::System::Ole::{
        DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize, DROPEFFECT,
        DROPEFFECT_COPY, DROPEFFECT_MOVE,
    };
    use windows::Win32::System::SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS};
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{
        ILFindLastID, SHCreateDataObject, SHDoDragDrop, SHParseDisplayName,
    };

    #[implement(IDropSource)]
    struct DropSource;

    impl IDropSource_Impl for DropSource_Impl {
        fn QueryContinueDrag(
            &self,
            fescapepressed: windows::core::BOOL,
            grfkeystate: MODIFIERKEYS_FLAGS,
        ) -> windows::core::HRESULT {
            if fescapepressed.as_bool() {
                return DRAGDROP_S_CANCEL;
            }
            if (grfkeystate & MK_LBUTTON).0 == 0 {
                return DRAGDROP_S_DROP;
            }
            S_OK
        }

        fn GiveFeedback(&self, _dweffect: DROPEFFECT) -> windows::core::HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    struct PidlList {
        folder: Option<*mut ITEMIDLIST>,
        items: Vec<*mut ITEMIDLIST>,
    }

    impl PidlList {
        fn new() -> Self {
            Self {
                folder: None,
                items: Vec::new(),
            }
        }

        fn set_folder(&mut self, pidl: *mut ITEMIDLIST) {
            self.folder = Some(pidl);
        }

        fn push(&mut self, pidl: *mut ITEMIDLIST) {
            self.items.push(pidl);
        }

        fn folder_ptr(&self) -> Option<*const ITEMIDLIST> {
            self.folder.map(|pidl| pidl as *const _)
        }

        fn is_empty(&self) -> bool {
            self.items.is_empty()
        }

        fn as_ptrs(&self) -> Vec<*const ITEMIDLIST> {
            self.items.iter().map(|pidl| *pidl as *const _).collect()
        }
    }

    impl Drop for PidlList {
        fn drop(&mut self) {
            if let Some(pidl) = self.folder.take() {
                unsafe {
                    CoTaskMemFree(Some(pidl as *const _));
                }
            }
            for pidl in self.items.drain(..) {
                unsafe {
                    CoTaskMemFree(Some(pidl as *const _));
                }
            }
        }
    }

    pub fn start_drag(paths: Vec<String>, hwnd: Option<HWND>) -> Result<DragOutcome, String> {
        let mut seen = HashSet::new();
        let mut filtered = Vec::new();
        for path in paths {
            let trimmed = path.trim();
            if trimmed.is_empty() || !Path::new(trimmed).exists() {
                continue;
            }
            if seen.insert(trimmed.to_string()) {
                filtered.push(trimmed.to_string());
            }
        }

        if filtered.is_empty() {
            return Err("No valid items to drag".to_string());
        }

        run_drag(filtered, hwnd)
    }

    fn run_drag(paths: Vec<String>, hwnd: Option<HWND>) -> Result<DragOutcome, String> {
        unsafe { OleInitialize(None).map_err(|err| err.to_string())? };
        let result = unsafe { perform_drag(paths, hwnd) };
        unsafe { OleUninitialize() };
        result
    }

    fn common_parent(paths: &[String]) -> Option<String> {
        let mut parent: Option<String> = None;
        for path in paths {
            let next = Path::new(path)
                .parent()
                .map(|value| value.to_string_lossy().to_string())?;
            match &parent {
                Some(prev) => {
                    if prev != &next {
                        return None;
                    }
                }
                None => parent = Some(next),
            }
        }
        parent
    }

    unsafe fn perform_drag(paths: Vec<String>, hwnd: Option<HWND>) -> Result<DragOutcome, String> {
        let mut pidls = PidlList::new();
        let folder_path = common_parent(&paths);
        let mut use_folder = false;

        if let Some(folder) = folder_path {
            let wide: Vec<u16> = OsStr::new(&folder).encode_wide().chain(once(0)).collect();
            let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
            if SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl, 0, None).is_ok()
                && !pidl.is_null()
            {
                pidls.set_folder(pidl);
                use_folder = true;
            }
        }

        for path in paths {
            let wide: Vec<u16> = OsStr::new(&path).encode_wide().chain(once(0)).collect();
            let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
            if SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl, 0, None).is_ok()
                && !pidl.is_null()
            {
                pidls.push(pidl);
            }
        }

        if pidls.is_empty() {
            return Err("No valid items to drag".to_string());
        }

        let mut pidl_ptrs = if use_folder {
            pidls
                .items
                .iter()
                .filter_map(|pidl| {
                    let child = unsafe { ILFindLastID(*pidl as *const _) };
                    if child.is_null() {
                        None
                    } else {
                        Some(child as *const _)
                    }
                })
                .collect::<Vec<_>>()
        } else {
            pidls.as_ptrs()
        };
        if pidl_ptrs.is_empty() {
            use_folder = false;
            pidl_ptrs = pidls.as_ptrs();
        }
        let data_object: IDataObject =
            SHCreateDataObject(
                if use_folder { pidls.folder_ptr() } else { None },
                Some(&pidl_ptrs),
                None::<&IDataObject>,
            )
            .map_err(|err| err.to_string())?;
        let drop_source: IDropSource = DropSource.into();

        let allowed = DROPEFFECT_COPY | DROPEFFECT_MOVE;
        let effect = if hwnd.is_some() {
            SHDoDragDrop(hwnd, &data_object, &drop_source, allowed)
                .map_err(|err| err.to_string())?
        } else {
            let mut effect = DROPEFFECT(0);
            let hr = DoDragDrop(&data_object, &drop_source, allowed, &mut effect);
            hr.ok().map_err(|err| err.to_string())?;
            effect
        };

        Ok(outcome_from_effect(effect))
    }

    fn outcome_from_effect(effect: DROPEFFECT) -> DragOutcome {
        if effect.0 & DROPEFFECT_MOVE.0 != 0 {
            DragOutcome::Move
        } else if effect.0 & DROPEFFECT_COPY.0 != 0 {
            DragOutcome::Copy
        } else {
            DragOutcome::None
        }
    }
}
