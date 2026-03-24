// Windows-native file copy helpers.
// CopyFile2 keeps large cross-drive copies on the OS path while the callback
// lets the transfer manager stay responsive to pause and cancel.
use super::common::windows_extended_path;
use crate::domain::filesystem::{
    TransferControlCallback, TransferProgressCallback, TransferProgressUpdate,
};
use std::ffi::c_void;
use std::mem::size_of;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    CopyFile2, COPYFILE2_CALLBACK_CHUNK_FINISHED, COPYFILE2_CALLBACK_STREAM_FINISHED,
    COPYFILE2_EXTENDED_PARAMETERS, COPYFILE2_MESSAGE, COPYFILE2_MESSAGE_ACTION,
    COPYFILE2_PROGRESS_CANCEL, COPYFILE2_PROGRESS_CONTINUE, COPYFILE_FLAGS, COPY_FILE_COPY_SYMLINK,
    COPY_FILE_DIRECTORY, COPY_FILE_OPEN_AND_COPY_REPARSE_POINT,
};

use super::common::TransferEntryKind;

struct NativeCopyContext {
    processed: usize,
    total: usize,
    current_total_bytes: u64,
    last_emitted_bytes: u64,
    callback_error: Option<String>,
    on_progress: Option<*mut TransferProgressCallback>,
    on_control: Option<*mut TransferControlCallback>,
}

impl NativeCopyContext {
    fn check_control(&mut self) -> Result<(), String> {
        let Some(handler) = self.on_control else {
            return Ok(());
        };
        unsafe { (*handler)() }
    }

    fn emit_bytes(&mut self, current_bytes: u64) {
        if current_bytes == self.last_emitted_bytes {
            return;
        }
        self.last_emitted_bytes = current_bytes;
        let Some(handler) = self.on_progress else {
            return;
        };
        unsafe {
            (*handler)(TransferProgressUpdate {
                processed: self.processed,
                total: self.total,
                current_path: None,
                current_bytes: Some(current_bytes),
                current_total_bytes: Some(self.current_total_bytes),
                progress_percent: None,
                status_text: None,
                rate_text: None,
            });
        }
    }
}

fn copy_flags_for(kind: TransferEntryKind) -> COPYFILE_FLAGS {
    let mut flags = COPYFILE_FLAGS(0);
    if matches!(
        kind,
        TransferEntryKind::SymlinkFile | TransferEntryKind::SymlinkDirectory
    ) {
        flags |= COPY_FILE_COPY_SYMLINK;
    }
    if matches!(
        kind,
        TransferEntryKind::ReparseFile | TransferEntryKind::ReparseDirectory
    ) {
        flags |= COPY_FILE_OPEN_AND_COPY_REPARSE_POINT;
    }
    if kind.is_directory_like() {
        flags |= COPY_FILE_DIRECTORY;
    }
    flags
}

unsafe extern "system" fn copy_progress_routine(
    message: *const COPYFILE2_MESSAGE,
    callback_context: *const c_void,
) -> COPYFILE2_MESSAGE_ACTION {
    let Some(message) = message.as_ref() else {
        return COPYFILE2_PROGRESS_CONTINUE;
    };
    let context = &mut *(callback_context as *mut NativeCopyContext);

    if let Err(error) = context.check_control() {
        context.callback_error = Some(error);
        return COPYFILE2_PROGRESS_CANCEL;
    }

    let transferred_bytes = match message.Type {
        COPYFILE2_CALLBACK_CHUNK_FINISHED => {
            Some(unsafe { message.Info.ChunkFinished.uliTotalBytesTransferred })
        }
        COPYFILE2_CALLBACK_STREAM_FINISHED => {
            Some(unsafe { message.Info.StreamFinished.uliTotalBytesTransferred })
        }
        _ => None,
    };

    if let Some(bytes) = transferred_bytes {
        context.emit_bytes(bytes.min(context.current_total_bytes));
    }

    COPYFILE2_PROGRESS_CONTINUE
}

pub(crate) fn copy_file_entry_native(
    src: &Path,
    dest: &Path,
    kind: TransferEntryKind,
    processed: usize,
    total: usize,
    current_total_bytes: u64,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    let src_wide = windows_extended_path(src)?;
    let dest_wide = windows_extended_path(dest)?;
    let progress_ptr = on_progress
        .as_deref_mut()
        .map(|handler| handler as *mut TransferProgressCallback);
    let control_ptr = on_control
        .as_deref_mut()
        .map(|handler| handler as *mut TransferControlCallback);

    let mut context = NativeCopyContext {
        processed,
        total,
        current_total_bytes,
        last_emitted_bytes: 0,
        callback_error: None,
        on_progress: progress_ptr,
        on_control: control_ptr,
    };

    let mut parameters = COPYFILE2_EXTENDED_PARAMETERS::default();
    parameters.dwSize = size_of::<COPYFILE2_EXTENDED_PARAMETERS>() as u32;
    parameters.dwCopyFlags = copy_flags_for(kind);
    parameters.pProgressRoutine = Some(copy_progress_routine);
    parameters.pvCallbackContext = (&mut context as *mut NativeCopyContext).cast::<c_void>();

    let result = unsafe {
        CopyFile2(
            PCWSTR(src_wide.as_ptr()),
            PCWSTR(dest_wide.as_ptr()),
            Some(&parameters as *const COPYFILE2_EXTENDED_PARAMETERS),
        )
    };

    if let Some(error) = context.callback_error.take() {
        return Err(error);
    }

    result.map_err(|error| error.to_string())
}
