// File operation creation and flag selection for shell-native delete jobs.
use super::ShellDeleteMode;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::UI::Shell::{
    FileOperation, IFileOperation, FILEOPERATION_FLAGS, FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO,
    FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
};

pub(super) fn create_file_operation() -> Result<IFileOperation, String> {
    unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_ALL) }.map_err(|err| err.to_string())
}

pub(super) fn file_operation_flags(mode: ShellDeleteMode) -> FILEOPERATION_FLAGS {
    let mut flags = FOF_SILENT | FOF_NOCONFIRMATION | FOF_NOERRORUI;
    if mode == ShellDeleteMode::Recycle {
        flags |= FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE;
    }
    flags
}
