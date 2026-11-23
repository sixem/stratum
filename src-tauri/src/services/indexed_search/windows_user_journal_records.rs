// Decode bounded batches of redacted V2 records without reading names.
use std::mem;

use windows_sys::Win32::{
    Storage::FileSystem::FILE_ATTRIBUTE_DIRECTORY,
    System::Ioctl::{
        USN_REASON_DATA_EXTEND, USN_REASON_DATA_OVERWRITE, USN_REASON_DATA_TRUNCATION,
        USN_REASON_FILE_CREATE, USN_REASON_FILE_DELETE, USN_REASON_HARD_LINK_CHANGE,
        USN_REASON_RENAME_NEW_NAME, USN_REASON_RENAME_OLD_NAME, USN_REASON_REPARSE_POINT_CHANGE,
        USN_REASON_SECURITY_CHANGE, USN_RECORD_V2,
    },
};

use super::UserJournalChange;

pub(super) const RECORD_VERSION: u16 = 2;
pub(super) const MAX_CHANGE_RECORDS: usize = 512;
pub(super) const NAMESPACE_REASONS: u32 = USN_REASON_FILE_CREATE
    | USN_REASON_FILE_DELETE
    | USN_REASON_RENAME_OLD_NAME
    | USN_REASON_RENAME_NEW_NAME
    | USN_REASON_HARD_LINK_CHANGE
    | USN_REASON_REPARSE_POINT_CHANGE
    | USN_REASON_SECURITY_CHANGE;
pub(super) const RELEVANT_REASONS: u32 = NAMESPACE_REASONS
    | USN_REASON_DATA_EXTEND
    | USN_REASON_DATA_TRUNCATION
    | USN_REASON_DATA_OVERWRITE;

const RECORD_HEADER_SIZE: usize = mem::offset_of!(USN_RECORD_V2, FileName);
const FILE_ID_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, FileReferenceNumber);
const PARENT_ID_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, ParentFileReferenceNumber);
const USN_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, Usn);
const REASON_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, Reason);
const ATTRIBUTES_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, FileAttributes);

pub(super) fn batch_cursor(buffer: &[u8]) -> Result<i64, ()> {
    Ok(i64::from_le_bytes(read_field(buffer, 0)?))
}

pub(super) fn collect_batch(
    buffer: &[u8],
    start_usn: i64,
    stop_usn: i64,
    changes: &mut Vec<UserJournalChange>,
) -> Result<i64, ()> {
    let next_usn = batch_cursor(buffer)?;
    if next_usn <= start_usn {
        return Err(());
    }
    let mut records = &buffer[mem::size_of::<i64>()..];
    let mut previous_usn = None;
    while !records.is_empty() {
        let length = u32::from_le_bytes(read_field(records, 0)?) as usize;
        if length < RECORD_HEADER_SIZE || !length.is_multiple_of(8) {
            return Err(());
        }
        let record = records.get(..length).ok_or(())?;
        if u16::from_le_bytes(read_field(record, 4)?) != RECORD_VERSION {
            return Err(());
        }
        let usn = i64::from_le_bytes(read_field(record, USN_OFFSET)?);
        if usn < start_usn || usn >= next_usn || previous_usn.is_some_and(|last| usn <= last) {
            return Err(());
        }
        if usn >= stop_usn {
            break;
        }
        previous_usn = Some(usn);
        records = &records[length..];

        let reason = u32::from_le_bytes(read_field(record, REASON_OFFSET)?);
        if reason & RELEVANT_REASONS == 0 {
            continue;
        }
        if changes.len() == MAX_CHANGE_RECORDS {
            // The kernel cursor covers the whole buffer, including records
            // deferred to the next reconciliation batch.
            return Ok(usn);
        }
        changes.push(UserJournalChange {
            file_id: u64::from_le_bytes(read_field(record, FILE_ID_OFFSET)?),
            parent_file_id: u64::from_le_bytes(read_field(record, PARENT_ID_OFFSET)?),
            reason,
            is_dir: u32::from_le_bytes(read_field(record, ATTRIBUTES_OFFSET)?)
                & FILE_ATTRIBUTE_DIRECTORY
                != 0,
        });
    }
    Ok(next_usn.min(stop_usn))
}

fn read_field<const N: usize>(record: &[u8], offset: usize) -> Result<[u8; N], ()> {
    record
        .get(offset..offset + N)
        .and_then(|value| value.try_into().ok())
        .ok_or(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn redacted_record(
        file_id: u64,
        parent_id: u64,
        reason: u32,
        usn: i64,
        is_dir: bool,
    ) -> [u8; 80] {
        let mut record = [0; 80];
        record[..4].copy_from_slice(&80u32.to_le_bytes());
        record[4..6].copy_from_slice(&RECORD_VERSION.to_le_bytes());
        record[FILE_ID_OFFSET..FILE_ID_OFFSET + 8].copy_from_slice(&file_id.to_le_bytes());
        record[PARENT_ID_OFFSET..PARENT_ID_OFFSET + 8].copy_from_slice(&parent_id.to_le_bytes());
        record[USN_OFFSET..USN_OFFSET + 8].copy_from_slice(&usn.to_le_bytes());
        record[REASON_OFFSET..REASON_OFFSET + 4].copy_from_slice(&reason.to_le_bytes());
        if is_dir {
            record[ATTRIBUTES_OFFSET..ATTRIBUTES_OFFSET + 4]
                .copy_from_slice(&FILE_ATTRIBUTE_DIRECTORY.to_le_bytes());
        }
        record
    }

    #[test]
    fn preserves_parent_ids_for_redacted_names_and_honors_snapshot_boundary() {
        let mut buffer = 1_000i64.to_le_bytes().to_vec();
        buffer.extend(redacted_record(1, 2, USN_REASON_DATA_OVERWRITE, 200, false));
        buffer.extend(redacted_record(3, 4, USN_REASON_RENAME_OLD_NAME, 300, true));
        buffer.extend(redacted_record(3, 5, USN_REASON_RENAME_NEW_NAME, 400, true));
        buffer.extend(redacted_record(
            7,
            8,
            USN_REASON_SECURITY_CHANGE,
            500,
            false,
        ));
        let mut changes = Vec::new();
        assert_eq!(collect_batch(&buffer, 100, 500, &mut changes), Ok(500));
        assert_eq!(
            changes,
            [
                UserJournalChange {
                    file_id: 1,
                    parent_file_id: 2,
                    reason: USN_REASON_DATA_OVERWRITE,
                    is_dir: false,
                },
                UserJournalChange {
                    file_id: 3,
                    parent_file_id: 4,
                    reason: USN_REASON_RENAME_OLD_NAME,
                    is_dir: true,
                },
                UserJournalChange {
                    file_id: 3,
                    parent_file_id: 5,
                    reason: USN_REASON_RENAME_NEW_NAME,
                    is_dir: true,
                },
            ]
        );
    }

    #[test]
    fn resumes_at_first_omitted_record_and_rejects_truncated_data() {
        let stop = 10_000i64;
        let mut buffer = stop.to_le_bytes().to_vec();
        let start = 100;
        for index in 0..=MAX_CHANGE_RECORDS {
            buffer.extend(redacted_record(
                index as u64,
                4,
                USN_REASON_SECURITY_CHANGE,
                start + index as i64,
                false,
            ));
        }
        let mut changes = Vec::new();
        assert_eq!(
            collect_batch(&buffer, start, stop, &mut changes),
            Ok(start + MAX_CHANGE_RECORDS as i64)
        );
        assert_eq!(changes.len(), MAX_CHANGE_RECORDS);
        let mut incomplete = stop.to_le_bytes().to_vec();
        incomplete.extend(&redacted_record(1, 2, USN_REASON_FILE_CREATE, 200, false)[..70]);
        assert!(collect_batch(&incomplete, start, stop, &mut Vec::new()).is_err());
    }
}
