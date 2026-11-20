// Ask the folder that owns these Shell items for its complete selection menu.
use std::{path::Path, ptr::NonNull};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::HWND,
        System::Com::CoTaskMemFree,
        UI::Shell::{
            Common::ITEMIDLIST, IContextMenu, ILClone, ILFindLastID, ILIsParent, ILRemoveLastID,
            IShellFolder, SHBindToParent, SHGetDesktopFolder, SHParseDisplayName,
        },
    },
};

struct ItemId(NonNull<ITEMIDLIST>);

impl ItemId {
    fn parse(path: &str) -> Result<Self, String> {
        if !Path::new(path).is_absolute() || path.contains('\0') {
            return Err("Select an absolute filesystem path.".into());
        }
        let wide: Vec<_> = path.encode_utf16().chain(Some(0)).collect();
        let mut item = std::ptr::null_mut();
        unsafe { SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut item, 0, None) }
            .map_err(|err| format!("Windows could not open {path}: {err}"))?;
        NonNull::new(item)
            .map(Self)
            .ok_or_else(|| format!("Windows could not identify {path}."))
    }

    fn parent(&self) -> Result<Self, String> {
        let cloned = NonNull::new(unsafe { ILClone(self.0.as_ptr()) })
            .ok_or("Windows could not copy the Shell item identifier.")?;
        let parent = Self(cloned);
        unsafe { ILRemoveLastID(Some(parent.0.as_ptr())) }
            .ok()
            .map_err(|e| e.to_string())?;
        Ok(parent)
    }
}

impl Drop for ItemId {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(Some(self.0.as_ptr().cast())) };
    }
}

pub(super) fn context_menu(
    owner: HWND,
    paths: &[String],
    background: Option<&str>,
) -> Result<IContextMenu, String> {
    if let Some(path) = background {
        if !paths.is_empty() {
            return Err("Choose either a selection or a folder background.".into());
        }
        let id = ItemId::parse(path)?;
        let desktop = unsafe { SHGetDesktopFolder() }.map_err(|e| e.to_string())?;
        let folder: IShellFolder = unsafe { desktop.BindToObject(id.0.as_ptr(), None) }
            .map_err(|e| format!("Windows could not open the folder: {e}"))?;
        return unsafe { folder.CreateViewObject(owner) }
            .map_err(|e| format!("Windows could not build the folder background menu: {e}"));
    }

    let items = paths
        .iter()
        .map(|path| ItemId::parse(path))
        .collect::<Result<Vec<_>, _>>()?;
    let first = items.first().ok_or("Select at least one item.")?;
    if items.len() > 1 {
        let parent = first.parent()?;
        if items[1..]
            .iter()
            .any(|item| unsafe { !ILIsParent(parent.0.as_ptr(), item.0.as_ptr(), true).as_bool() })
        {
            return Err("Windows requires the selected items to be in the same folder.".into());
        }
    }
    let folder: IShellFolder =
        unsafe { SHBindToParent(first.0.as_ptr(), None) }.map_err(|e| e.to_string())?;
    // GetUIObjectOf requires child identifiers relative to this particular folder.
    // Their storage belongs to the full PIDLs and stays alive through the call.
    let children: Vec<_> = items
        .iter()
        .map(|item| unsafe { ILFindLastID(item.0.as_ptr()).cast_const() })
        .collect();
    unsafe { folder.GetUIObjectOf(owner, &children, None) }
        .map_err(|e| format!("Windows could not build a menu for this selection: {e}"))
}
