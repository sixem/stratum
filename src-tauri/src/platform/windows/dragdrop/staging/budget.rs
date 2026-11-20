// A single budget covers all temporary contents created for one drop.
use super::DropDataError;
use std::fs::File;
use std::io::Write;
use windows::Win32::System::Com::IStream;

pub(in crate::platform::windows::dragdrop) const MAX_ITEMS: usize = 4_096;
pub(in crate::platform::windows::dragdrop) const MAX_DEPTH: usize = 32;
const MAX_BYTES: u64 = 1024 * 1024 * 1024;

pub(in crate::platform::windows::dragdrop) struct StagingBudget {
    entries_left: usize,
    bytes_left: u64,
}

impl StagingBudget {
    pub(in crate::platform::windows::dragdrop) fn new() -> Self {
        Self {
            entries_left: MAX_ITEMS,
            bytes_left: MAX_BYTES,
        }
    }

    #[cfg(test)]
    pub(in crate::platform::windows::dragdrop) fn with_limits(entries: usize, bytes: u64) -> Self {
        Self {
            entries_left: entries,
            bytes_left: bytes,
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
        self.bytes_left = self
            .bytes_left
            .checked_sub(bytes.len() as u64)
            .ok_or(DropDataError::TooLarge)?;
        file.write_all(bytes)
            .map_err(|_| DropDataError::StagingFailed)
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
