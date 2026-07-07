// Windows-specific drive capability detection for the indexed-search service.
//
// The first implementation only classifies drives for the NTFS fast path.
// Actual catalog population and journal tracking will be added behind the same
// boundary in later passes.
use std::ffi::OsStr;
use std::iter::once;
use std::os::windows::ffi::OsStrExt;

use windows_sys::Win32::Storage::FileSystem::{
    GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
};

use crate::domain::indexed_search::{IndexedDriveState, IndexedDriveStatus};

use super::state::now_epoch_ms;

// Windows reports fixed local drives with the legacy DRIVE_FIXED code.
const DRIVE_TYPE_FIXED: u32 = 3;

pub(super) fn discover_drive_statuses() -> Vec<IndexedDriveStatus> {
    let mask = unsafe { GetLogicalDrives() };
    if mask == 0 {
        return Vec::new();
    }

    let now = now_epoch_ms();
    let mut statuses = Vec::new();

    for index in 0..26 {
        if (mask >> index) & 1 == 0 {
            continue;
        }

        let letter = (b'A' + index as u8) as char;
        let drive_path = format!("{letter}:\\");
        statuses.push(classify_drive(&drive_path, now));
    }

    statuses
}

fn classify_drive(drive_path: &str, now: u64) -> IndexedDriveStatus {
    let drive_type = drive_type(drive_path);
    let filesystem = volume_filesystem(drive_path);

    if filesystem.is_none() {
        return IndexedDriveStatus {
            drive_path: drive_path.to_string(),
            filesystem: None,
            state: IndexedDriveState::Unavailable,
            indexable: false,
            started_at: Some(now),
            last_updated_at: now,
            entry_count: None,
            source_label: None,
            message: Some("Drive metadata is currently unavailable.".to_string()),
        };
    }

    let filesystem_name = filesystem.clone().unwrap_or_default();
    let is_fixed_ntfs =
        drive_type == DRIVE_TYPE_FIXED && filesystem_name.eq_ignore_ascii_case("NTFS");
    let (state, indexable, message) = if is_fixed_ntfs {
        (
            IndexedDriveState::Queued,
            true,
            Some("Queued for indexed-search setup.".to_string()),
        )
    } else if drive_type != DRIVE_TYPE_FIXED {
        (
            IndexedDriveState::Unsupported,
            false,
            Some("Indexed search supports fixed NTFS drives only in v1.".to_string()),
        )
    } else {
        (
            IndexedDriveState::Unsupported,
            false,
            Some("Indexed search supports NTFS drives only in v1.".to_string()),
        )
    };

    IndexedDriveStatus {
        drive_path: drive_path.to_string(),
        filesystem,
        state,
        indexable,
        started_at: Some(now),
        last_updated_at: now,
        entry_count: None,
        source_label: None,
        message,
    }
}

fn drive_type(path: &str) -> u32 {
    let wide = wide(path);
    unsafe { GetDriveTypeW(wide.as_ptr()) }
}

fn volume_filesystem(path: &str) -> Option<String> {
    let wide = wide(path);
    let mut filesystem_buffer = [0u16; 128];
    let ok = unsafe {
        GetVolumeInformationW(
            wide.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            filesystem_buffer.as_mut_ptr(),
            filesystem_buffer.len() as u32,
        )
    };
    if ok == 0 {
        return None;
    }
    let len = filesystem_buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(filesystem_buffer.len());
    let filesystem = String::from_utf16_lossy(&filesystem_buffer[..len]);
    let trimmed = filesystem.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(once(0)).collect()
}
