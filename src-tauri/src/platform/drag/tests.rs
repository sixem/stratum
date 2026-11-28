// Read the outbound formats the same way a Windows drop target would.
use super::{
    prepare_drag,
    source::{outcome_from_effect, DRAG_EFFECTS},
    DragOutcome,
};
use crate::platform::windows::com::StaComGuard;
use std::{
    fs::{self, OpenOptions},
    os::windows::{ffi::OsStringExt, fs::OpenOptionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use windows::Win32::System::Com::{CoTaskMemFree, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
use windows::Win32::System::Ole::{
    ReleaseStgMedium, CF_HDROP, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE,
};
use windows::Win32::UI::Shell::{
    DragQueryFileW, IShellItemArray, SHCreateShellItemArrayFromDataObject, HDROP, SIGDN_FILESYSPATH,
};
use windows_sys::Win32::Storage::FileSystem::{GetShortPathNameW, FILE_FLAG_BACKUP_SEMANTICS};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("stratum-drag-{}-{suffix}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

// A Shell path can spell the same file with long or 8.3 directory names.
fn file_identity(path: &Path) -> (u64, u128) {
    let handle = OpenOptions::new()
        .access_mode(0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .unwrap();
    crate::domain::filesystem::file_identity::file_id(&handle).unwrap()
}

// Exercise an 8.3 parent when the filesystem provides one, as on CI runners.
fn short_path_or_original(path: &Path) -> PathBuf {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let required = unsafe { GetShortPathNameW(wide.as_ptr(), std::ptr::null_mut(), 0) };
    if required == 0 {
        return path.to_path_buf();
    }
    let mut short = vec![0; required as usize];
    let written = unsafe { GetShortPathNameW(wide.as_ptr(), short.as_mut_ptr(), required) };
    if written == 0 || written >= required {
        return path.to_path_buf();
    }
    PathBuf::from(std::ffi::OsString::from_wide(&short[..written as usize]))
}

#[test]
fn mixed_parent_files_and_folders_round_trip_through_both_windows_formats() {
    let f = Fixture::new();
    let folder = short_path_or_original(&f.0).join("résumé 📂");
    fs::create_dir(&folder).unwrap();
    let file = folder.join("日本語.txt");
    fs::write(&file, b"fixture").unwrap();
    let paths: Vec<String> = [&file, &folder]
        .map(|p| p.to_str().unwrap().to_owned())
        .into();
    let mut selection = paths.clone();
    selection.push(paths[0].clone());
    let prepared = std::thread::spawn(|| prepare_drag(selection))
        .join()
        .unwrap()
        .unwrap();
    let _com = StaComGuard::new().unwrap();
    let data = prepared.data_object().unwrap();
    let format = FORMATETC {
        cfFormat: CF_HDROP.0,
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
        ..Default::default()
    };
    unsafe {
        assert!(data.QueryGetData(&format).is_ok());
        let mut medium = data.GetData(&format).unwrap();
        let hdrop = HDROP(medium.u.hGlobal.0);
        assert_eq!(DragQueryFileW(hdrop, u32::MAX, None), 2);
        for (index, expected) in paths.iter().enumerate() {
            let len = DragQueryFileW(hdrop, index as u32, None);
            let mut name = vec![0; len as usize + 1];
            assert_eq!(DragQueryFileW(hdrop, index as u32, Some(&mut name)), len);
            assert_eq!(
                &String::from_utf16(&name[..len as usize]).unwrap(),
                expected
            );
        }
        ReleaseStgMedium(&mut medium);

        let items: IShellItemArray = SHCreateShellItemArrayFromDataObject(&data).unwrap();
        assert_eq!(items.GetCount().unwrap(), 2);
        for (index, expected) in paths.iter().enumerate() {
            let name = items
                .GetItemAt(index as u32)
                .unwrap()
                .GetDisplayName(SIGDN_FILESYSPATH)
                .unwrap();
            let actual = name.to_string().unwrap();
            CoTaskMemFree(Some(name.0.cast()));
            // Resolve both spellings to their filesystem identities in selection order.
            assert_eq!(
                file_identity(Path::new(&actual)),
                file_identity(Path::new(expected)),
                "Shell item {index}: {actual:?} (selected {expected:?})"
            );
        }
    }
}

#[test]
fn unavailable_selection_member_fails_without_silently_sending_a_subset() {
    let f = Fixture::new();
    let present = f.0.join("present.txt");
    fs::write(&present, b"fixture").unwrap();
    let missing = f.0.join("gone.txt").to_str().unwrap().to_owned();
    let error = prepare_drag(vec![present.to_str().unwrap().into(), missing.clone()])
        .err()
        .unwrap();
    assert!(error.contains(&missing));
    assert!(prepare_drag(vec!["relative.txt".into()]).is_err());
    assert!(prepare_drag(Vec::new()).is_err());
}

#[test]
fn link_only_targets_can_negotiate_a_successful_drop() {
    assert_eq!(DRAG_EFFECTS & DROPEFFECT_LINK, DROPEFFECT_LINK);
    assert_eq!(outcome_from_effect(DROPEFFECT_LINK), DragOutcome::Link);
    assert_eq!(outcome_from_effect(DROPEFFECT_COPY), DragOutcome::Copy);
    assert_eq!(outcome_from_effect(DROPEFFECT_MOVE), DragOutcome::Move);
}

#[test]
fn late_cancel_only_invalidates_its_own_or_older_preparation() {
    super::cancel_drag_start(12);
    super::cancel_drag_start(11);
    assert!(super::start_was_canceled(Some(12)));
    assert!(!super::start_was_canceled(Some(13)));
    assert!(!super::start_was_canceled(None));
}
