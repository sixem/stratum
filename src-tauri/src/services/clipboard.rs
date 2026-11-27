// A clipboard read captures the Shell's copy/move preference together with
// the file list and the Windows sequence number that identifies this selection.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipboardMode {
    #[default]
    Copy,
    Move,
}

#[derive(Debug, Serialize)]
pub struct FileClipboard {
    pub paths: Vec<String>,
    pub mode: ClipboardMode,
    pub sequence: u32,
}

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{
    finish_file_cut, get_file_clipboard, set_clipboard_paths, set_clipboard_text,
    set_remote_clipboard,
};

#[cfg(not(windows))]
pub fn get_file_clipboard() -> Result<FileClipboard, String> {
    Err("File clipboard integration requires Windows.".into())
}

#[cfg(not(windows))]
pub fn set_clipboard_paths(_: usize, _: Vec<String>, _: ClipboardMode) -> Result<(), String> {
    Err("File clipboard integration requires Windows.".into())
}

#[cfg(not(windows))]
pub fn set_clipboard_text(_: usize, _: String) -> Result<(), String> {
    Err("Clipboard integration requires Windows.".into())
}

#[cfg(not(windows))]
pub fn set_remote_clipboard(_: usize, _: String, _: String) -> Result<u32, String> {
    Err("Clipboard integration requires Windows.".into())
}

#[cfg(not(windows))]
pub fn finish_file_cut(_: usize, _: u32, _: Vec<String>) -> Result<(), String> {
    Err("File clipboard integration requires Windows.".into())
}
