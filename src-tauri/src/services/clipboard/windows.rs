// Publish CF_HDROP and Preferred DropEffect under one clipboard lock. The
// receiver handles the move itself, so Cut has no filesystem side effects.
use super::{ClipboardMode, FileClipboard};
use crate::platform::windows::file_drop::write_dropfiles;
use ::windows::Win32::{
    Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND},
    System::{
        DataExchange::{
            CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber,
            IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
        },
        Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE},
        Ole::{CF_HDROP, CF_UNICODETEXT, DROPEFFECT_COPY, DROPEFFECT_MOVE},
    },
    UI::Shell::{DragQueryFileW, CFSTR_PREFERREDDROPEFFECT, HDROP},
};
use std::{collections::HashSet, fs, path::Path, thread, time::Duration};

fn effect_format() -> Result<u32, String> {
    let format = unsafe { RegisterClipboardFormatW(CFSTR_PREFERREDDROPEFFECT) };
    if format == 0 {
        Err("Could not register the Windows clipboard transfer mode.".into())
    } else {
        Ok(format)
    }
}

struct OpenGuard;
impl OpenGuard {
    fn open(owner: Option<HWND>) -> Result<Self, String> {
        // Clipboard monitors can hold the lock briefly. Only the worker waits.
        for attempt in 0..5 {
            match unsafe { OpenClipboard(owner) } {
                Ok(()) => return Ok(Self),
                Err(err) if attempt == 4 => {
                    return Err(format!("Windows clipboard is unavailable: {err}"))
                }
                Err(_) => thread::sleep(Duration::from_millis(10)),
            }
        }
        unreachable!()
    }
}

impl Drop for OpenGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

// SetClipboardData takes ownership only on success.
struct Memory(HGLOBAL);

impl Memory {
    fn from_text(text: &str) -> Result<Self, String> {
        let bytes: Vec<u8> = text
            .encode_utf16()
            .chain(Some(0))
            .flat_map(u16::to_le_bytes)
            .collect();
        Self::from_bytes(&bytes)
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        unsafe {
            let block =
                Self(GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|err| err.to_string())?);
            let address = GlobalLock(block.0).cast::<u8>();
            if address.is_null() {
                return Err("Cannot lock clipboard memory.".into());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), address, bytes.len());
            let _ = GlobalUnlock(block.0);
            Ok(block)
        }
    }

    fn publish(self, format: u32) -> Result<(), String> {
        unsafe { SetClipboardData(format, Some(HANDLE(self.0 .0))) }
            .map_err(|err| err.to_string())?;
        std::mem::forget(self);
        Ok(())
    }
}

impl Drop for Memory {
    fn drop(&mut self) {
        unsafe {
            let _ = GlobalFree(Some(self.0));
        }
    }
}

struct FileFormats {
    files: Memory,
    effect: Memory,
    effect_format: u32,
    text: Memory,
}

impl FileFormats {
    fn prepare(paths: &[String], mode: ClipboardMode) -> Result<Self, String> {
        let effect = match mode {
            ClipboardMode::Copy => DROPEFFECT_COPY,
            ClipboardMode::Move => DROPEFFECT_MOVE,
        };
        Ok(Self {
            files: Memory(write_dropfiles(paths)?),
            effect: Memory::from_bytes(&effect.0.to_le_bytes())?,
            effect_format: effect_format()?,
            text: Memory::from_text(&paths.join("\r\n"))?,
        })
    }

    fn replace(self, _guard: &OpenGuard) -> Result<(), String> {
        unsafe { EmptyClipboard() }.map_err(|err| err.to_string())?;
        // Publish file paths only once their mandatory transfer mode is present.
        self.effect.publish(self.effect_format)?;
        self.files.publish(CF_HDROP.0.into())?;
        // The file selection is already complete. Text is a compatibility format.
        let _ = self.text.publish(CF_UNICODETEXT.0.into());
        Ok(())
    }
}

pub fn set_clipboard_text(owner: usize, text: String) -> Result<(), String> {
    if text.contains('\0') {
        return Err("Clipboard text contains a null character.".into());
    }
    let text = Memory::from_text(&text)?;
    let _guard = OpenGuard::open(Some(HWND(owner as _)))?;
    unsafe { EmptyClipboard() }.map_err(|err| err.to_string())?;
    text.publish(CF_UNICODETEXT.0.into())
}

// Windows updates the sequence when the writing clipboard lock closes. A
// private marker lets us verify our write after reopening without accepting a
// different application's clipboard contents in the intervening window.
pub fn set_remote_clipboard(
    owner: usize,
    text: String,
    token: String,
    expected_sequence: Option<u32>,
) -> Result<u32, String> {
    if text.contains('\0')
        || token.len() != 36
        || !token.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return Err("Invalid remote clipboard selection.".into());
    }
    let format =
        unsafe { RegisterClipboardFormatW(::windows::core::w!("Stratum.RemoteSelection")) };
    if format == 0 {
        return Err("Could not register the remote clipboard format.".into());
    }
    let data = Memory::from_text(&text)?;
    let marker = Memory::from_bytes(token.as_bytes())?;
    {
        let _guard = OpenGuard::open(Some(HWND(owner as _)))?;
        if expected_sequence
            .is_some_and(|seq| seq == 0 || seq != unsafe { GetClipboardSequenceNumber() })
        {
            return Ok(0);
        }
        unsafe { EmptyClipboard() }.map_err(|e| e.to_string())?;
        if expected_sequence.is_some() && text.is_empty() {
            return Ok(0);
        }
        marker.publish(format)?;
        data.publish(CF_UNICODETEXT.0.into())?;
    }
    let _guard = OpenGuard::open(None)?;
    let handle = unsafe { GetClipboardData(format) }
        .map_err(|_| "The clipboard changed; copy the selection again.")?;
    let block = HGLOBAL(handle.0);
    if unsafe { GlobalSize(block) } < token.len() {
        return Err("The clipboard changed; copy the selection again.".into());
    }
    let ptr = unsafe { GlobalLock(block) }.cast::<u8>();
    if ptr.is_null() {
        return Err("Could not read the remote clipboard marker.".into());
    }
    let matches = unsafe { std::slice::from_raw_parts(ptr, token.len()) } == token.as_bytes();
    unsafe {
        let _ = GlobalUnlock(block);
    }
    if !matches {
        return Err("The clipboard changed; copy the selection again.".into());
    }
    let sequence = unsafe { GetClipboardSequenceNumber() };
    if sequence == 0 {
        return Err("Windows did not provide a clipboard sequence.".into());
    }
    Ok(sequence)
}

fn validate_path(path: &str) -> Result<(), String> {
    if !Path::new(path).is_absolute() || path.trim() != path || path.contains('\0') {
        return Err(format!(
            "Cannot transfer an invalid or ambiguous file path: {path}"
        ));
    }
    Ok(())
}

pub fn set_clipboard_paths(
    owner: usize,
    paths: Vec<String>,
    mode: ClipboardMode,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    for path in paths {
        if seen.insert(path.clone()) {
            validate_path(&path)?;
            fs::symlink_metadata(&path).map_err(|err| format!("Cannot access {path}: {err}"))?;
            selected.push(path);
        }
    }
    if selected.is_empty() {
        return Err("Select at least one file or folder.".into());
    }
    let formats = FileFormats::prepare(&selected, mode)?;
    let guard = OpenGuard::open(Some(HWND(owner as _)))?;
    formats.replace(&guard)
}

fn read_mode() -> Result<ClipboardMode, String> {
    let format = effect_format()?;
    let block = if unsafe { IsClipboardFormatAvailable(format) }.is_ok() {
        let handle = unsafe { GetClipboardData(format) }.map_err(|err| err.to_string())?;
        Some(HGLOBAL(handle.0))
    } else {
        None
    };
    decode_mode(block)
}

fn decode_mode(block: Option<HGLOBAL>) -> Result<ClipboardMode, String> {
    let Some(block) = block else {
        return Ok(ClipboardMode::Copy);
    };
    if unsafe { GlobalSize(block) } < 4 {
        return Err("Invalid clipboard transfer mode.".into());
    }
    let ptr = unsafe { GlobalLock(block) }.cast::<u32>();
    if ptr.is_null() {
        return Err("Cannot read the clipboard transfer mode.".into());
    }
    let value = unsafe { ptr.read_unaligned() };
    unsafe {
        let _ = GlobalUnlock(block);
    }
    // Windows file copies can offer COPY | LINK. Only an explicit MOVE cuts.
    Ok(if value == DROPEFFECT_MOVE.0 {
        ClipboardMode::Move
    } else {
        ClipboardMode::Copy
    })
}

fn decode_paths(drop: HDROP) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    let mut name = Vec::new();
    let count = unsafe { DragQueryFileW(drop, u32::MAX, None) };
    for index in 0..count {
        let len = unsafe { DragQueryFileW(drop, index, None) };
        // Reuse the UTF-16 scratch space across filenames in the selection.
        name.resize(len as usize + 1, 0);
        if len == 0 || unsafe { DragQueryFileW(drop, index, Some(&mut name)) } != len {
            return Err("Could not read the complete file selection.".into());
        }
        let path = String::from_utf16(&name[..len as usize]).map_err(|err| err.to_string())?;
        validate_path(&path)?;
        paths.push(path);
    }
    Ok(paths)
}

fn read_locked(_guard: &OpenGuard) -> Result<FileClipboard, String> {
    let (paths, mode) = if unsafe { IsClipboardFormatAvailable(CF_HDROP.0.into()) }.is_ok() {
        let handle =
            unsafe { GetClipboardData(CF_HDROP.0.into()) }.map_err(|err| err.to_string())?;
        (decode_paths(HDROP(handle.0))?, read_mode()?)
    } else {
        (Vec::new(), ClipboardMode::Copy)
    };
    // Delayed data rendering can increment this number on the first read.
    Ok(FileClipboard {
        paths,
        mode,
        sequence: unsafe { GetClipboardSequenceNumber() },
    })
}

pub fn get_file_clipboard() -> Result<FileClipboard, String> {
    read_locked(&OpenGuard::open(None)?)
}

pub fn finish_file_cut(owner: usize, sequence: u32, moved: Vec<String>) -> Result<(), String> {
    if sequence == 0 || moved.is_empty() {
        return Ok(());
    }
    let guard = OpenGuard::open(Some(HWND(owner as _)))?;
    if unsafe { GetClipboardSequenceNumber() } != sequence {
        return Ok(());
    }
    let Some(remaining) = remaining_cut_paths(read_locked(&guard)?, sequence, moved) else {
        return Ok(());
    };
    if remaining.is_empty() {
        return unsafe { EmptyClipboard() }.map_err(|err| err.to_string());
    }
    FileFormats::prepare(&remaining, ClipboardMode::Move)?.replace(&guard)
}

fn remaining_cut_paths(
    snapshot: FileClipboard,
    sequence: u32,
    moved: Vec<String>,
) -> Option<Vec<String>> {
    if sequence == 0
        || snapshot.sequence != sequence
        || snapshot.mode != ClipboardMode::Move
        || moved.is_empty()
    {
        return None;
    }
    let consumed: HashSet<_> = moved.into_iter().collect();
    let original_count = snapshot.paths.len();
    let remaining: Vec<_> = snapshot
        .paths
        .into_iter()
        .filter(|path| !consumed.contains(path))
        .collect();
    (remaining.len() != original_count).then_some(remaining)
}

#[cfg(test)]
mod tests;
