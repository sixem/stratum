// A single budget covers all temporary contents created for one drop.
use super::DropDataError;
use std::fs::File;
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::Win32::System::Com::IStream;

pub(in crate::platform::windows::dragdrop) const MAX_ITEMS: usize = 4_096;
pub(in crate::platform::windows::dragdrop) const MAX_DEPTH: usize = 32;
const SPACE_RESERVE_BYTES: u64 = 256 * 1024 * 1024;
const SPACE_CHECK_INTERVAL_BYTES: usize = 32 * 1024 * 1024;

struct StagingVolume {
    directory: Vec<u16>,
    bytes_until_check: usize,
}

impl StagingVolume {
    fn available_bytes(&self) -> Result<u64, DropDataError> {
        let mut free = 0;
        // Measure the actual staging volume using the space available to this user.
        unsafe {
            GetDiskFreeSpaceExW(PCWSTR(self.directory.as_ptr()), Some(&mut free), None, None)
        }
        .map_err(|_| DropDataError::StagingFailed)?;
        Ok(free.saturating_sub(SPACE_RESERVE_BYTES))
    }
}

pub(in crate::platform::windows::dragdrop) struct StagingBudget {
    entries_left: usize,
    bytes_left: u64,
    volume: Option<StagingVolume>,
}

impl StagingBudget {
    pub(in crate::platform::windows::dragdrop) fn for_directory(
        directory: &Path,
    ) -> Result<Self, DropDataError> {
        let volume = StagingVolume {
            directory: directory
                .as_os_str()
                .encode_wide()
                .chain([u16::from(b'\\'), 0])
                .collect(),
            bytes_until_check: SPACE_CHECK_INTERVAL_BYTES,
        };
        Ok(Self {
            entries_left: MAX_ITEMS,
            bytes_left: volume.available_bytes()?,
            volume: Some(volume),
        })
    }

    #[cfg(test)]
    pub(in crate::platform::windows::dragdrop) fn with_limits(entries: usize, bytes: u64) -> Self {
        Self {
            entries_left: entries,
            bytes_left: bytes,
            volume: None,
        }
    }

    pub(in crate::platform::windows::dragdrop) fn reserve_entry(
        &mut self,
    ) -> Result<(), DropDataError> {
        self.entries_left = self
            .entries_left
            .checked_sub(1)
            .ok_or(DropDataError::TooManyItems)?;
        Ok(())
    }

    pub(in crate::platform::windows::dragdrop) fn remaining_bytes(&self) -> u64 {
        self.bytes_left
    }

    pub(in crate::platform::windows::dragdrop) fn write(
        &mut self,
        file: &mut File,
        bytes: &[u8],
    ) -> Result<(), DropDataError> {
        if bytes.len() as u64 > self.bytes_left {
            return Err(DropDataError::InsufficientSpace);
        }
        // External copies can use space while a drop is staging. Recheck in
        // batches, also splitting large single-buffer writes from HGLOBAL.
        for chunk in bytes.chunks(SPACE_CHECK_INTERVAL_BYTES) {
            if let Some(volume) = &mut self.volume {
                if chunk.len() > volume.bytes_until_check {
                    self.bytes_left = self.bytes_left.min(volume.available_bytes()?);
                    volume.bytes_until_check = SPACE_CHECK_INTERVAL_BYTES;
                }
                volume.bytes_until_check -= chunk.len();
            }
            self.bytes_left = self
                .bytes_left
                .checked_sub(chunk.len() as u64)
                .ok_or(DropDataError::InsufficientSpace)?;
            file.write_all(chunk)
                .map_err(DropDataError::from_staging_io)?;
        }
        Ok(())
    }
}

// Read provider-owned data into a fixed buffer and enforce the budget before
// every write. The provider's advertised size, if present, is a separate check.
pub(in crate::platform::windows::dragdrop) fn copy_stream(
    stream: &IStream,
    expected: Option<u64>,
    file: &mut File,
    budget: &mut StagingBudget,
) -> Result<(), DropDataError> {
    let mut buffer = vec![0; 64 * 1024];
    let mut total = 0u64;
    loop {
        let mut read = 0;
        unsafe {
            stream.Read(
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
                Some(&mut read),
            )
        }
        .ok()
        .map_err(|_| DropDataError::InvalidSource)?;
        if read == 0 {
            break;
        }
        let contents = buffer
            .get(..read as usize)
            .ok_or(DropDataError::InvalidSource)?;
        total += u64::from(read);
        if expected.is_some_and(|size| total > size) {
            return Err(DropDataError::InvalidSource);
        }
        budget.write(file, contents)?;
    }
    if expected.is_some_and(|size| total != size) {
        return Err(DropDataError::InvalidSource);
    }
    Ok(())
}
