// Prepare Shell identifiers on a worker and publish the complete file selection to OLE.
use crate::platform::windows::{com::StaComGuard, file_drop::write_dropfiles};
use std::{collections::HashSet, path::Path, ptr::NonNull};
use windows::core::PCWSTR;
use windows::Win32::System::Com::{
    CoTaskMemFree, IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
};
use windows::Win32::System::Ole::{ReleaseStgMedium, CF_HDROP};
use windows::Win32::UI::Shell::{
    BHID_DataObject, Common::ITEMIDLIST, SHCreateDataObject, SHCreateShellItemArrayFromIDLists,
    SHParseDisplayName,
};

struct OwnedPidl(NonNull<ITEMIDLIST>);

// A fully qualified PIDL is an immutable byte buffer in COM task memory.
// Its allocation has no COM interface or apartment affinity.
unsafe impl Send for OwnedPidl {}

impl Drop for OwnedPidl {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(Some(self.0.as_ptr().cast())) }
    }
}

pub(crate) struct PreparedDrag {
    paths: Vec<String>,
    pidls: Vec<OwnedPidl>,
}

pub(crate) fn prepare_drag(paths: Vec<String>) -> Result<PreparedDrag, String> {
    let _com = StaComGuard::new()?;
    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    let mut pidls = Vec::new();
    for path in paths {
        if !Path::new(&path).is_absolute() || path.contains('\0') {
            return Err(format!("Cannot drag an invalid file path: {path}"));
        }
        if !seen.insert(path.clone()) {
            continue;
        }
        let wide: Vec<_> = path.encode_utf16().chain(Some(0)).collect();
        let mut pidl = std::ptr::null_mut();
        unsafe { SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl, 0, None) }.ok();
        if let Some(pidl) = NonNull::new(pidl) {
            pidls.push(OwnedPidl(pidl));
        } else {
            // A real item can be outside the Shell parser's namespace (e.g. an
            // extended path). File-list consumers can still receive it unchanged.
            std::fs::symlink_metadata(&path).map_err(|err| format!("Cannot drag {path}: {err}"))?;
        }
        selected.push(path);
    }
    if selected.is_empty() {
        return Err("No files selected to drag.".into());
    }
    Ok(PreparedDrag {
        paths: selected,
        pidls,
    })
}

impl PreparedDrag {
    pub(crate) fn data_object(&self) -> Result<IDataObject, String> {
        let shell_data = if self.pidls.len() == self.paths.len() {
            let ptrs: Vec<_> = self
                .pidls
                .iter()
                .map(|p| p.0.as_ptr().cast_const())
                .collect();
            // This API accepts absolute PIDLs, including items from different parents.
            unsafe {
                SHCreateShellItemArrayFromIDLists(&ptrs)
                    .and_then(|items| items.BindToHandler(None, &BHID_DataObject))
            }
            .ok()
        } else {
            None
        };
        let data: IDataObject = match shell_data {
            Some(data) => data,
            None => unsafe { SHCreateDataObject(None, None, None::<&IDataObject>) }
                .map_err(|err| err.to_string())?,
        };
        // File-list-only targets (including non-Shell apps) get every path in
        // selection order even if the Shell couldn't parse one of the entries.
        let format = FORMATETC {
            cfFormat: CF_HDROP.0,
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
            ..Default::default()
        };
        let mut medium = STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 {
                hGlobal: write_dropfiles(&self.paths)?,
            },
            ..Default::default()
        };
        if let Err(err) = unsafe { data.SetData(&format, &medium, true) } {
            unsafe { ReleaseStgMedium(&mut medium) };
            return Err(err.to_string());
        }
        Ok(data)
    }
}
