// Stage Shell IDList selections through filesystem reads or provider streams.
use super::data::DropDataError;
use super::stage_slots::StageSlots;
use super::staging::{
    copy_stream, create_stage_entry, reserve_stage_entry, stage_filesystem_item, DropStage,
    ReceivedFiles, StagingBudget, MAX_ITEMS,
};
use std::ffi::OsStr;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use windows::core::PCWSTR;
use windows::Win32::System::Com::{
    CoTaskMemFree, IDataObject, IStream, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL, TYMED_ISTREAM,
};
use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows::Win32::System::SystemServices::{SFGAO_FOLDER, SFGAO_STREAM};
use windows::Win32::UI::Shell::{
    BHID_EnumItems, BHID_StorageEnum, BHID_Stream, IEnumShellItems, IShellItem, IShellItemArray,
    SHCreateShellItemArrayFromDataObject, SIGDN, SIGDN_FILESYSPATH, SIGDN_NORMALDISPLAY,
    SIGDN_PARENTRELATIVEPARSING,
};

const CFSTR_SHELLIDLIST: PCWSTR = windows::core::w!("Shell IDList Array");

pub(super) fn supports_shell_id_list(data: &IDataObject) -> bool {
    static FORMAT: OnceLock<u16> = OnceLock::new();
    let format =
        *FORMAT.get_or_init(|| unsafe { RegisterClipboardFormatW(CFSTR_SHELLIDLIST) } as u16);
    format != 0
        && (has_format(data, format, TYMED_HGLOBAL.0 as u32)
            || has_format(data, format, TYMED_ISTREAM.0 as u32))
}

pub(super) fn materialize_shell_id_list_paths(
    data: &IDataObject,
    slots: &StageSlots,
) -> Result<ReceivedFiles, DropDataError> {
    let items: IShellItemArray = unsafe { SHCreateShellItemArrayFromDataObject(data) }
        .map_err(|_| DropDataError::InvalidSource)?;
    let count = unsafe { items.GetCount() }.map_err(|_| DropDataError::InvalidSource)? as usize;
    if count == 0 {
        return Err(DropDataError::InvalidSource);
    }
    if count > MAX_ITEMS {
        return Err(DropDataError::TooManyItems);
    }

    // Keep reads with the COM provider on its calling apartment. Only our
    // bounded writer creates files, including for virtual folder descendants.
    let stage = DropStage::new(slots)?;
    let mut budget = StagingBudget::new();
    let mut paths = Vec::with_capacity(count);
    for index in 0..count {
        let item =
            unsafe { items.GetItemAt(index as u32) }.map_err(|_| DropDataError::InvalidSource)?;
        let path = stage_shell_item(&item, stage.path(), stage.path(), 1, &mut budget)?;
        paths.push(
            path.to_str()
                .ok_or(DropDataError::InvalidSource)?
                .to_owned(),
        );
    }
    paths.sort();
    Ok(ReceivedFiles::staged(paths, stage))
}

fn stage_shell_item(
    item: &IShellItem,
    stage_root: &Path,
    parent: &Path,
    depth: usize,
    budget: &mut StagingBudget,
) -> Result<PathBuf, DropDataError> {
    if let Some(path) = read_name(item, SIGDN_FILESYSPATH) {
        let source = Path::new(&path);
        if !source.is_absolute() {
            return Err(DropDataError::InvalidSource);
        }
        return stage_filesystem_item(source, stage_root, parent, depth, budget);
    }

    reserve_stage_entry(depth, budget)?;
    let name = read_name(item, SIGDN_PARENTRELATIVEPARSING)
        .or_else(|| read_name(item, SIGDN_NORMALDISPLAY))
        .ok_or(DropDataError::UnsupportedShellItems)?;
    let attributes = unsafe { item.GetAttributes(SFGAO_FOLDER | SFGAO_STREAM) }
        .map_err(|_| DropDataError::UnsupportedShellItems)?;

    if attributes.contains(SFGAO_FOLDER) && !attributes.contains(SFGAO_STREAM) {
        let children: IEnumShellItems = unsafe { item.BindToHandler(None, &BHID_EnumItems) }
            .or_else(|_| unsafe { item.BindToHandler(None, &BHID_StorageEnum) })
            .map_err(|_| DropDataError::UnsupportedShellItems)?;
        let (destination, ()) =
            create_stage_entry(parent, OsStr::new(&name), |path| fs::create_dir(path))?;
        loop {
            let mut child = [None];
            let mut fetched = 0;
            unsafe { children.Next(&mut child, Some(&mut fetched)) }
                .map_err(|_| DropDataError::InvalidSource)?;
            match (fetched, child[0].take()) {
                (0, None) => break,
                (1, Some(child)) => {
                    stage_shell_item(&child, stage_root, &destination, depth + 1, budget)?;
                }
                _ => return Err(DropDataError::InvalidSource),
            }
        }
        return Ok(destination);
    }

    let stream: IStream = unsafe { item.BindToHandler(None, &BHID_Stream) }
        .map_err(|_| DropDataError::UnsupportedShellItems)?;
    let (destination, mut file) =
        create_stage_entry(parent, OsStr::new(&name), |path| File::create_new(path))?;
    copy_stream(&stream, None, &mut file, budget)?;
    Ok(destination)
}

fn read_name(item: &IShellItem, kind: SIGDN) -> Option<String> {
    let name = unsafe { item.GetDisplayName(kind) }.ok()?;
    if name.is_null() {
        return None;
    }
    let value = unsafe { name.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(name.0.cast())) };
    value.filter(|name| !name.is_empty())
}

fn has_format(data: &IDataObject, format: u16, tymed: u32) -> bool {
    let format_etc = FORMATETC {
        cfFormat: format,
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed,
        ..Default::default()
    };
    unsafe { data.QueryGetData(&format_etc).is_ok() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::{drag::prepare_drag, windows::com::StaComGuard};

    #[test]
    fn stages_a_native_shell_id_list_folder_without_delegating_writes() {
        let _apartment = StaComGuard::new().unwrap();
        let slots = StageSlots::default();
        let source = DropStage::new(&slots).unwrap();
        let directory = source.path().join("documents");
        fs::create_dir(&directory).unwrap();
        let original = directory.join("note.txt");
        fs::write(&original, b"notes").unwrap();
        let payload = prepare_drag(vec![directory.to_str().unwrap().to_owned()]).unwrap();
        let data = payload.data_object().unwrap();

        let files = materialize_shell_id_list_paths(&data, &slots).unwrap();
        assert_eq!(files.paths.len(), 1);
        assert_eq!(
            fs::read(Path::new(&files.paths[0]).join("note.txt")).unwrap(),
            b"notes"
        );
        drop(files);
        assert_eq!(fs::read(original).unwrap(), b"notes");
    }
}
