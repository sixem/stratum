use super::*;
use crate::domain::filesystem::{
    transfer::{transfer_entries, TRANSFER_CANCELLED_MESSAGE},
    TransferMode, TransferOptions, TransferProgressUpdate,
};
use ::windows::Win32::System::Ole::DROPEFFECT_LINK;
use std::{cell::Cell, path::PathBuf, rc::Rc};

struct TempFolder(PathBuf);
impl Drop for TempFolder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

// Hold the actual Win32 memory formats locally. DragQueryFileW, GlobalLock,
// and the transfer executor run normally without opening the user's clipboard.
fn snapshot(formats: &FileFormats, seq: u32) -> FileClipboard {
    FileClipboard {
        paths: decode_paths(HDROP(formats.files.0 .0)).unwrap(),
        mode: decode_mode(Some(formats.effect.0)).unwrap(),
        sequence: seq,
    }
}

#[test]
fn text_clipboard_encodes_unicode_lines_and_the_windows_terminator() {
    let input = "一.txt\r\n📁 Folder";
    let memory = Memory::from_text(input).unwrap();
    let expected: Vec<_> = input.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let ptr = GlobalLock(memory.0).cast::<u16>();
        assert!(!ptr.is_null());
        assert_eq!(std::slice::from_raw_parts(ptr, expected.len()), expected);
        let _ = GlobalUnlock(memory.0);
    }
}

#[test]
fn reads_shell_formats_from_independent_handles() {
    let names = vec![r"C:\source\一.txt".into(), r"\\server\share\two".into()];
    let copy = FileFormats::prepare(&names, ClipboardMode::Copy).unwrap();
    assert_eq!(snapshot(&copy, 4).paths, names);
    assert_eq!(snapshot(&copy, 4).mode, ClipboardMode::Copy);
    let cut = FileFormats::prepare(&names, ClipboardMode::Move).unwrap();
    assert_eq!(snapshot(&cut, 5).mode, ClipboardMode::Move);
    // Other producers may omit the preferred effect, or offer COPY | LINK.
    assert_eq!(decode_mode(None).unwrap(), ClipboardMode::Copy);
    let combined =
        Memory::from_bytes(&(DROPEFFECT_COPY.0 | DROPEFFECT_LINK.0).to_le_bytes()).unwrap();
    assert_eq!(decode_mode(Some(combined.0)).unwrap(), ClipboardMode::Copy);
    assert!(remaining_cut_paths(snapshot(&copy, 4), 4, names.clone()).is_none());
    // Even identical paths arriving on a new clipboard generation are independent.
    assert!(remaining_cut_paths(snapshot(&cut, 50), 5, names.clone()).is_none());
    assert!(remaining_cut_paths(snapshot(&cut, 0), 0, names.clone()).is_none());
    assert!(remaining_cut_paths(snapshot(&cut, 5), 5, Vec::new()).is_none());
    assert_eq!(
        remaining_cut_paths(snapshot(&cut, 5), 5, names),
        Some(Vec::new())
    );
}

#[test]
fn cancelled_paste_reconciles_only_committed_files_and_yields_undo_paths() {
    let root = std::env::temp_dir().join(format!("stratum-cut-{}", std::process::id()));
    fs::create_dir(&root).unwrap();
    let _fixture = TempFolder(root.clone());
    let target = root.join("target");
    fs::create_dir(&target).unwrap();
    let first = root.join("一.txt");
    let second = root.join("two.txt");
    fs::write(&first, b"first").unwrap();
    fs::write(&second, b"second").unwrap();
    let both = vec![
        first.to_str().unwrap().to_owned(),
        second.to_str().unwrap().to_owned(),
    ];
    let formats = FileFormats::prepare(&both, ClipboardMode::Move).unwrap();
    let cut = snapshot(&formats, 14);
    assert!(first.exists() && second.exists());
    let canceled = Rc::new(Cell::new(false));
    let marker = canceled.clone();
    let mut progress = move |update: TransferProgressUpdate| {
        if update.processed == 1 {
            marker.set(true);
        }
    };
    let mut control = move || {
        if canceled.get() {
            Err(TRANSFER_CANCELLED_MESSAGE.to_string())
        } else {
            Ok(())
        }
    };
    let options = TransferOptions {
        mode: Some(TransferMode::Move),
        ..Default::default()
    };
    let report = transfer_entries(
        cut.paths,
        target.to_str().unwrap().into(),
        Some(options.clone()),
        Some(&mut progress),
        Some(&mut control),
    )
    .unwrap();
    assert!(report.cancelled);
    assert!(report.failures.is_empty());
    let [committed] = report.moved_entries.as_slice() else {
        panic!("Expected one committed move")
    };
    assert_eq!(committed.source_path, both[0]);
    assert_eq!(fs::read(&committed.destination_path).unwrap(), b"first");
    assert_eq!(fs::read(&second).unwrap(), b"second");
    assert!(!first.exists());
    let remaining = remaining_cut_paths(
        snapshot(&formats, 14),
        cut.sequence,
        vec![committed.source_path.clone()],
    )
    .unwrap();
    assert_eq!(remaining, both[1..]);
    let pending = FileFormats::prepare(&remaining, ClipboardMode::Move).unwrap();
    assert_eq!(snapshot(&pending, 15).paths, both[1..]);
    assert_eq!(snapshot(&pending, 15).mode, ClipboardMode::Move);
    let undo = transfer_entries(
        vec![committed.destination_path.clone()],
        root.to_str().unwrap().into(),
        Some(options),
        None,
        None,
    )
    .unwrap();
    assert_eq!(undo.moved, 1);
    assert_eq!(fs::read(&first).unwrap(), b"first");
}
