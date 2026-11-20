// Builds the Unicode CF_HDROP representation shared by the clipboard and OLE drags.
use std::{mem::size_of, ptr};
use windows::core::BOOL;
use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
};
use windows::Win32::UI::Shell::DROPFILES;

// The caller owns the returned handle until a successful clipboard or COM handoff.
pub(crate) fn write_dropfiles(paths: &[String]) -> Result<HGLOBAL, String> {
    let mut names = Vec::new();
    for path in paths {
        if path.contains('\0') || path.is_empty() {
            return Err("A file path is empty or contains a null character.".into());
        }
        names.extend(path.encode_utf16());
        names.push(0);
    }
    names.push(0);
    let byte_count = names
        .len()
        .checked_mul(size_of::<u16>())
        .and_then(|size| size.checked_add(size_of::<DROPFILES>()))
        .ok_or("The file list is too large.")?;

    unsafe {
        let handle = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, byte_count)
            .map_err(|err| err.to_string())?;
        let bytes = GlobalLock(handle).cast::<u8>();
        if bytes.is_null() {
            let _ = GlobalFree(Some(handle));
            return Err("Could not allocate the file list.".into());
        }
        bytes.cast::<DROPFILES>().write(DROPFILES {
            pFiles: size_of::<DROPFILES>() as u32,
            fWide: BOOL(1),
            ..Default::default()
        });
        ptr::copy_nonoverlapping(
            names.as_ptr(),
            bytes.add(size_of::<DROPFILES>()).cast(),
            names.len(),
        );
        let _ = GlobalUnlock(handle);
        Ok(handle)
    }
}
