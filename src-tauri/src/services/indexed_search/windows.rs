// Discover Windows drive letters and verify the volumes currently mounted on them.
use std::io;
use std::iter::once;

use windows_sys::Win32::Storage::FileSystem::{
    GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW, GetVolumeNameForVolumeMountPointW,
};

use crate::domain::indexed_search::{IndexedDriveState, IndexedDriveStatus};

use super::state::now_epoch_ms;

// Win32's drive type return values from GetDriveTypeW.
const DRIVE_UNKNOWN: u32 = 0;
const DRIVE_NO_ROOT_DIR: u32 = 1;
const DRIVE_FIXED: u32 = 3;
const VOLUME_GUID_CAPACITY: usize = 50;

pub(super) struct DiscoveredDrive {
    pub(super) status: IndexedDriveStatus,
    pub(super) volume_identity: Option<String>,
    // The canonical GUID path can be opened independently of the drive letter.
    pub(super) volume_guid: Option<String>,
}

pub(super) fn discover_drives() -> Result<Vec<DiscoveredDrive>, String> {
    let mask = unsafe { GetLogicalDrives() };
    if mask == 0 {
        return Err(format!(
            "Failed to enumerate Windows drives: {}",
            io::Error::last_os_error()
        ));
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

    Ok(statuses)
}

pub(super) fn discover_drive(drive_path: &str) -> DiscoveredDrive {
    classify_drive(drive_path, now_epoch_ms())
}

fn classify_drive(drive_path: &str, now: u64) -> DiscoveredDrive {
    let root = wide(drive_path);
    let mut drive = DiscoveredDrive {
        status: IndexedDriveStatus {
            drive_path: drive_path.to_string(),
            filesystem: None,
            state: IndexedDriveState::Unavailable,
            indexable: false,
            searchable: false,
            started_at: Some(now),
            last_updated_at: now,
            entry_count: None,
            source_label: None,
            message: None,
        },
        volume_identity: None,
        volume_guid: None,
    };

    let drive_type = unsafe { GetDriveTypeW(root.as_ptr()) };
    match drive_type {
        DRIVE_NO_ROOT_DIR | DRIVE_UNKNOWN => {
            drive.status.message = Some("Drive is currently unavailable.".to_string());
            return drive;
        }
        DRIVE_FIXED => {}
        _ => {
            // Non-fixed drives are outside our scope. Avoid opening network
            // roots, optical drives, and removable media during refreshes.
            drive.status.state = IndexedDriveState::Unsupported;
            drive.status.message = Some("Indexed search supports fixed NTFS drives.".to_string());
            return drive;
        }
    }

    let guid = volume_guid_path(&root);
    // Prefer the GUID path so that the serial and filesystem come from the
    // same volume even when the drive letter changes during discovery.
    let info = match &guid {
        Ok(path) => volume_information(&wide(path)),
        Err(_) => volume_information(&root),
    };
    let Ok((filesystem, serial)) = info else {
        drive.status.message = Some("Drive metadata is currently unavailable.".to_string());
        return drive;
    };
    let is_ntfs = filesystem.eq_ignore_ascii_case("NTFS");
    drive.status.filesystem = Some(filesystem);
    if !is_ntfs {
        drive.status.state = IndexedDriveState::Unsupported;
        drive.status.message = Some("Indexed search supports NTFS drives only.".to_string());
        return drive;
    }

    let Ok(guid) = guid else {
        drive.status.message =
            Some("The drive's volume identity is currently unavailable.".to_string());
        return drive;
    };
    if !volume_guid_path(&root).is_ok_and(|current| current.eq_ignore_ascii_case(&guid)) {
        drive.status.message = Some("The drive mount changed during volume discovery.".to_string());
        return drive;
    }

    drive.status.state = IndexedDriveState::Queued;
    drive.status.indexable = true;
    drive.status.message = Some("Queued for indexed-search setup.".to_string());
    drive.volume_identity = Some(stable_volume_identity(&guid, serial));
    drive.volume_guid = Some(guid);
    drive
}

fn volume_guid_path(root: &[u16]) -> io::Result<String> {
    let mut guid = [0u16; VOLUME_GUID_CAPACITY];
    let ok = unsafe {
        GetVolumeNameForVolumeMountPointW(root.as_ptr(), guid.as_mut_ptr(), guid.len() as u32)
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let guid = buffer_text(&guid);
    if guid.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Windows returned an empty volume GUID path",
        ));
    }
    Ok(guid)
}

fn volume_information(root: &[u16]) -> io::Result<(String, u32)> {
    let mut serial = 0u32;
    let mut filesystem = [0u16; 128];
    let ok = unsafe {
        GetVolumeInformationW(
            root.as_ptr(),
            std::ptr::null_mut(),
            0,
            &mut serial,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            filesystem.as_mut_ptr(),
            filesystem.len() as u32,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let filesystem = buffer_text(&filesystem);
    if filesystem.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Windows returned an empty filesystem name",
        ));
    }
    Ok((filesystem, serial))
}

fn buffer_text(buffer: &[u16]) -> String {
    let len = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len])
}

fn stable_volume_identity(guid: &str, serial: u32) -> String {
    // A reformat can keep the GUID while changing the filesystem serial.
    format!("{}:{serial:08x}", guid.to_ascii_lowercase())
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_accounts_for_the_volume_and_its_format() {
        let volume = r"\\?\Volume{4a96cb09-08c1-433f-b38f-093c3f29edaa}\";
        let replacement = r"\\?\Volume{1db0eafa-280c-4b44-a572-a72df1b32d32}\";
        let identity = stable_volume_identity(volume, 42);
        assert_eq!(
            identity,
            stable_volume_identity(&volume.to_ascii_uppercase(), 42)
        );
        assert_ne!(identity, stable_volume_identity(volume, 43));
        assert_ne!(identity, stable_volume_identity(replacement, 42));
    }
}
