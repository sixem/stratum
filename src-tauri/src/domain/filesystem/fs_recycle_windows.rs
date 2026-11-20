// Validate the physical Recycle Bin item returned by the Windows shell.
use crate::domain::filesystem::file_identity::file_id;
use crate::platform::windows::file_names::plain_component;
use std::fs::File;
use std::io::{self, Read};
use std::mem::size_of;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{LocalFree, HANDLE, HLOCAL};
use windows::Win32::Security::{
    Authorization::ConvertSidToStringSidW, GetTokenInformation, TokenUser, SECURITY_MAX_SID_SIZE,
    TOKEN_QUERY, TOKEN_USER,
};
use windows::Win32::Storage::FileSystem::{
    GetDriveTypeW, DELETE, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_SHARE_DELETE,
    FILE_SHARE_READ, FILE_SHARE_WRITE,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

// The larger Windows metadata format holds up to a 32,767-unit extended path.
const MAX_RECORD_BYTES: usize = 28 + 32_768 * 2;
const DRIVE_FIXED: u32 = 3;
pub(super) const MAX_RECYCLED_ITEMS: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct FileIdentity {
    index: (u64, u128),
    created: u64,
}

impl FileIdentity {
    fn of(file: &File) -> io::Result<Self> {
        Ok(Self {
            index: file_id(file)?,
            created: file.metadata()?.creation_time(),
        })
    }
}

pub(super) fn recycle_source_identity(path: &Path) -> io::Result<FileIdentity> {
    let file = File::options()
        .access_mode(FILE_READ_ATTRIBUTES.0)
        .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE).0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)?;
    FileIdentity::of(&file)
}

#[derive(Debug)]
pub(crate) struct RecycleEntry {
    pub original_path: String,
    pub info_path: PathBuf,
    pub data_path: PathBuf,
    pub deleted_at: u64,
    data_identity: FileIdentity,
    info_identity: FileIdentity,
}

fn drive_letter(path: &str) -> Option<u8> {
    let [drive, b':', b'\\', ..] = path.as_bytes() else {
        return None;
    };
    drive
        .is_ascii_alphabetic()
        .then(|| drive.to_ascii_uppercase())
}

fn drive_root(letter: u8) -> String {
    format!("{}:\\", char::from(letter))
}

fn is_fixed_drive(root: &str) -> bool {
    let wide: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
    unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) == DRIVE_FIXED }
}

pub(crate) fn can_use_recycle_bin(path: &Path) -> bool {
    // Recycle Bin support is limited to fixed local drives.
    normalize_recycle_path(&path.to_string_lossy())
        .and_then(|path| drive_letter(&path))
        .is_some_and(|letter| is_fixed_drive(&drive_root(letter)))
}

pub(super) fn normalize_recycle_path(value: &str) -> Option<String> {
    let separated = value.replace('/', "\\");
    let path = separated
        .strip_prefix("\\\\?\\")
        .or_else(|| separated.strip_prefix("\\??\\"))
        .unwrap_or(&separated);
    let drive = drive_letter(path)?;
    let relative = path[3..].strip_suffix('\\').unwrap_or(&path[3..]);
    let mut components = relative.split('\\');
    let first = components.next()?;
    if !plain_component(first)
        || first.eq_ignore_ascii_case("$Recycle.Bin")
        || !components.all(plain_component)
    {
        return None;
    }
    // Preserve component spelling because Windows directories can be case-sensitive.
    Some(format!("{}:\\{relative}", char::from(drive)))
}

fn filetime_to_epoch_ms(filetime: u64) -> Option<u64> {
    const FILETIME_EPOCH: u64 = 116_444_736_000_000_000;
    filetime
        .checked_sub(FILETIME_EPOCH)
        .map(|ticks| ticks / 10_000)
}

fn decode_recycle_info(buffer: &[u8]) -> Option<(String, u64)> {
    if !(24..=MAX_RECORD_BYTES).contains(&buffer.len()) {
        return None;
    }
    let version = u64::from_le_bytes(buffer[0..8].try_into().ok()?);
    let deleted_at = filetime_to_epoch_ms(u64::from_le_bytes(buffer[16..24].try_into().ok()?))?;
    let bytes = match version {
        // Version 1 stores a null-terminated path in a fixed-width field.
        1 if buffer.len() == 24 + 260 * 2 => &buffer[24..],
        // Version 2 stores the UTF-16 unit count and the exact path field.
        2 => {
            let count = u32::from_le_bytes(buffer.get(24..28)?.try_into().ok()?) as usize;
            let bytes = &buffer[28..];
            let declared = count.checked_mul(2)?;
            if bytes.len() != declared
                && !(bytes.len().checked_sub(2) == Some(declared) && bytes.ends_with(&[0, 0]))
            {
                return None;
            }
            bytes
        }
        _ => return None,
    };
    let mut units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|unit| u16::from_le_bytes([unit[0], unit[1]]))
        .collect();
    if let Some(end) = units.iter().position(|unit| *unit == 0) {
        // Version 2 has at most one terminator. Version 1 may zero-pad its field.
        if (version == 2 && end + 1 != units.len()) || units[end..].iter().any(|unit| *unit != 0) {
            return None;
        }
        units.truncate(end);
    } else if version == 1 {
        return None;
    }
    let path = String::from_utf16(&units).ok()?;
    Some((normalize_recycle_path(&path)?, deleted_at))
}

fn open_recycle_info(info_path: &Path, for_restore: bool) -> io::Result<File> {
    let access = FILE_READ_DATA.0 | FILE_READ_ATTRIBUTES.0 | if for_restore { DELETE.0 } else { 0 };
    File::options()
        .access_mode(access)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(info_path)
}

fn parse_recycle_info(file: &File) -> Option<(String, u64)> {
    let metadata = file.metadata().ok()?;
    if !metadata.is_file()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
        || metadata.len() > MAX_RECORD_BYTES as u64
    {
        return None;
    }
    let mut buffer = Vec::new();
    file.take(MAX_RECORD_BYTES as u64 + 1)
        .read_to_end(&mut buffer)
        .ok()?;
    decode_recycle_info(&buffer)
}

pub(super) fn pin_plain_directory(path: &Path) -> io::Result<File> {
    let directory = File::options()
        .access_mode(FILE_READ_ATTRIBUTES.0)
        .share_mode(FILE_SHARE_READ.0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)?;
    let metadata = directory.metadata()?;
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
        return Err(io::Error::other(
            "The Recycle Bin or restore path contains a redirected folder.",
        ));
    }
    Ok(directory)
}

fn pin_recycle_directories(data_path: &Path) -> io::Result<[File; 2]> {
    let sid_path = data_path
        .parent()
        .ok_or_else(|| io::Error::other("Missing Recycle Bin folder."))?;
    let recycle_root = sid_path
        .parent()
        .ok_or_else(|| io::Error::other("Missing Recycle Bin root."))?;
    let recycle_dir = pin_plain_directory(recycle_root)?;
    let user_dir = pin_plain_directory(sid_path)?;
    Ok([recycle_dir, user_dir])
}

pub(super) fn current_user_sid() -> Option<String> {
    #[repr(C)]
    struct TokenUserBuffer {
        user: TOKEN_USER,
        sid_storage: [u8; SECURITY_MAX_SID_SIZE as usize],
    }

    let mut raw_token = HANDLE::default();
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw_token) }.ok()?;
    let token = unsafe { OwnedHandle::from_raw_handle(raw_token.0) };
    let mut buffer = TokenUserBuffer {
        user: TOKEN_USER::default(),
        sid_storage: [0; SECURITY_MAX_SID_SIZE as usize],
    };
    let mut returned = 0;
    unsafe {
        GetTokenInformation(
            HANDLE(token.as_raw_handle()),
            TokenUser,
            Some((&mut buffer as *mut TokenUserBuffer).cast()),
            size_of::<TokenUserBuffer>() as u32,
            &mut returned,
        )
    }
    .ok()?;
    let mut sid = PWSTR::null();
    unsafe { ConvertSidToStringSidW(buffer.user.User.Sid, &mut sid) }.ok()?;
    let text = unsafe { sid.to_string() }.ok();
    unsafe { LocalFree(Some(HLOCAL(sid.0.cast()))) };
    text
}

fn recycled_data_path(original: &str, shell_path: &str, sid: &str) -> Option<PathBuf> {
    let root = drive_root(drive_letter(original)?);
    let expected_parent = Path::new(&root).join("$Recycle.Bin").join(sid);
    let path = Path::new(shell_path.strip_prefix("\\\\?\\").unwrap_or(shell_path));
    let name = path.file_name()?.to_str()?;
    let suffix = name.strip_prefix("$R")?;
    if suffix.is_empty()
        || !plain_component(name)
        || !path
            .parent()?
            .to_str()?
            .eq_ignore_ascii_case(expected_parent.to_str()?)
    {
        return None;
    }
    Some(expected_parent.join(name))
}

impl RecycleEntry {
    pub(super) fn capture(
        original_path: &str,
        shell_path: &str,
        sid: &str,
        data_identity: FileIdentity,
    ) -> Option<Self> {
        let original_path = normalize_recycle_path(original_path)?;
        let data_path = recycled_data_path(&original_path, shell_path, sid)?;
        let suffix = data_path.file_name()?.to_str()?.strip_prefix("$R")?;
        let info_path = data_path.with_file_name(format!("$I{suffix}"));
        let _parents = pin_recycle_directories(&data_path).ok()?;
        if recycle_source_identity(&data_path).ok()? != data_identity {
            return None;
        }
        Self::capture_record(original_path, data_path, info_path, data_identity)
    }

    fn capture_record(
        original_path: String,
        data_path: PathBuf,
        info_path: PathBuf,
        data_identity: FileIdentity,
    ) -> Option<Self> {
        let info = open_recycle_info(&info_path, false).ok()?;
        let info_identity = FileIdentity::of(&info).ok()?;
        let (recorded_path, deleted_at) = parse_recycle_info(&info)?;
        if recorded_path != original_path {
            return None;
        }
        Some(Self {
            original_path,
            info_path,
            data_path,
            deleted_at,
            data_identity,
            info_identity,
        })
    }

    #[cfg(test)]
    pub(super) fn fixture(
        original_path: String,
        data_path: PathBuf,
        info_path: PathBuf,
    ) -> Option<Self> {
        let identity = recycle_source_identity(&data_path).ok()?;
        Self::capture_record(original_path, data_path, info_path, identity)
    }

    pub(super) fn open_for_restore(&self) -> io::Result<RecycleRestoreHandles> {
        let parents = pin_recycle_directories(&self.data_path)?;
        let data = File::options()
            .access_mode(FILE_READ_ATTRIBUTES.0 | DELETE.0)
            .share_mode(FILE_SHARE_READ.0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(&self.data_path)?;
        let info = open_recycle_info(&self.info_path, true)?;
        if FileIdentity::of(&data)? != self.data_identity
            || FileIdentity::of(&info)? != self.info_identity
            || !parse_recycle_info(&info)
                .is_some_and(|(path, time)| path == self.original_path && time == self.deleted_at)
        {
            return Err(io::Error::other(
                "The recycled item or its metadata changed.",
            ));
        }
        Ok(RecycleRestoreHandles {
            data,
            info,
            _parents: parents,
        })
    }
}

pub(super) struct RecycleRestoreHandles {
    pub data: File,
    pub info: File,
    _parents: [File; 2],
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_paths_require_unambiguous_local_components() {
        let path = "C:\\Data\\Season 4\\Episode 1.mkv";
        assert_eq!(normalize_recycle_path(path).as_deref(), Some(path));
        assert_eq!(
            normalize_recycle_path("\\\\?\\c:\\Data\\Season 4\\Episode 1.mkv").as_deref(),
            Some(path)
        );
        assert!(normalize_recycle_path("Data\\Episode.mkv").is_none());
        assert!(normalize_recycle_path("\\\\Server\\Share\\Episode.mkv").is_none());
        assert!(normalize_recycle_path("C:\\Data\\..\\Episode.mkv").is_none());
        assert!(normalize_recycle_path("C:\\Data\\Episode.mkv:stream").is_none());
        assert!(normalize_recycle_path("C:\\Data\\Episode.mkv.").is_none());
    }

    #[test]
    fn recycle_metadata_must_use_a_complete_versioned_path() {
        let path = "C:\\Data\\Episode.mkv";
        let units: Vec<_> = path.encode_utf16().chain(Some(0)).collect();
        let mut record = Vec::new();
        record.extend(2u64.to_le_bytes());
        record.extend(0u64.to_le_bytes());
        record.extend(116_444_736_000_000_000u64.to_le_bytes());
        record.extend((units.len() as u32).to_le_bytes());
        record.extend(units.into_iter().flat_map(u16::to_le_bytes));
        assert_eq!(decode_recycle_info(&record), Some((path.to_string(), 0)));

        record.pop();
        assert!(decode_recycle_info(&record).is_none());
        record[0] = 3;
        assert!(decode_recycle_info(&record).is_none());
    }
}
