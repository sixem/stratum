// Verify and remove the same directory entry through one Windows handle.
use super::{SourceSnapshot, TransferManifestEntry};
use std::collections::HashMap;
use std::fs::{File, Metadata, OpenOptions};
use std::io;
use std::mem::{size_of, MaybeUninit};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;
use windows_sys::Win32::Storage::FileSystem::{
    FileBasicInfo, FileDispositionInfo, GetFileInformationByHandleEx, SetFileInformationByHandle,
    DELETE, FILE_BASIC_INFO, FILE_DISPOSITION_INFO, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_SHARE_DELETE,
    FILE_SHARE_READ,
};

pub(super) struct SourceFile(File);

impl SourceFile {
    pub(super) fn open(path: &Path, for_cleanup: bool) -> io::Result<Self> {
        let access = if for_cleanup {
            FILE_READ_ATTRIBUTES | DELETE
        } else {
            FILE_READ_ATTRIBUTES | FILE_READ_DATA
        };
        OpenOptions::new()
            .access_mode(access)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .map(Self)
    }

    pub(super) fn metadata(&self) -> io::Result<Metadata> {
        self.0.metadata()
    }

    pub(super) fn change_time(&self) -> io::Result<Option<i128>> {
        let mut info = MaybeUninit::<FILE_BASIC_INFO>::uninit();
        let ok = unsafe {
            GetFileInformationByHandleEx(
                self.0.as_raw_handle() as isize,
                FileBasicInfo,
                info.as_mut_ptr().cast(),
                size_of::<FILE_BASIC_INFO>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        let time = unsafe { info.assume_init() }.ChangeTime;
        Ok((time != 0).then_some(i128::from(time)))
    }

    pub(super) fn identity(&self) -> io::Result<(u64, u128)> {
        crate::domain::filesystem::file_identity::file_id(&self.0)
    }

    pub(super) fn remove(&self, _entry: &TransferManifestEntry) -> io::Result<()> {
        let disposition = FILE_DISPOSITION_INFO { DeleteFile: 1 };
        let ok = unsafe {
            SetFileInformationByHandle(
                self.0.as_raw_handle() as isize,
                FileDispositionInfo,
                (&disposition as *const FILE_DISPOSITION_INFO).cast(),
                size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

struct AliasGroup {
    remaining: usize,
    guard: Option<(File, Option<i128>)>,
}

pub(super) struct LinkedSources(HashMap<(u64, u128), AliasGroup>);

impl LinkedSources {
    pub(super) fn new(snapshots: &[SourceSnapshot]) -> Self {
        let mut groups = HashMap::new();
        for snapshot in snapshots
            .iter()
            .filter(|entry| entry.file_version.is_some())
        {
            let group = groups.entry(snapshot.identity).or_insert(AliasGroup {
                remaining: 0,
                guard: None,
            });
            group.remaining += 1;
        }
        groups.retain(|_, group| group.remaining > 1);
        groups.shrink_to_fit();
        Self(groups)
    }

    pub(super) fn has_guards(&self) -> bool {
        self.0.values().any(|group| group.guard.is_some())
    }

    pub(super) fn verify(
        &mut self,
        entry: &TransferManifestEntry,
        snapshot: &SourceSnapshot,
        mut current: SourceSnapshot,
    ) -> io::Result<bool> {
        let Some(group) = self.0.get_mut(&snapshot.identity) else {
            return Ok(current == *snapshot);
        };
        if let Some((_, copied_change_time)) = &group.guard {
            // Our earlier unlink updates NTFS ChangeTime. The read handle has
            // denied writes since the first alias was verified against its copy.
            current.change_time = *copied_change_time;
        }
        if current != *snapshot {
            return Ok(false);
        }
        group.remaining -= 1;
        if group.remaining == 0 {
            group.guard = None;
        } else if group.guard.is_none() {
            // The caller still holds the verified no-rename handle. Opening a
            // separate reader with delete sharing lets us retire each name
            // while preventing content edits through any other name.
            let guard = OpenOptions::new()
                .access_mode(FILE_READ_DATA | FILE_READ_ATTRIBUTES)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&entry.source)?;
            group.guard = Some((guard, snapshot.change_time));
        }
        Ok(true)
    }
}
