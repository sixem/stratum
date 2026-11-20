// Decode only the fields needed for catalog updates. The kernel returns a
// next-USN cursor followed by variable-length, eight-byte-aligned records.
use crate::platform::windows::file_names::plain_component;
use std::mem;
use windows_sys::Win32::System::Ioctl::{
    USN_REASON_FILE_CREATE, USN_REASON_FILE_DELETE, USN_REASON_HARD_LINK_CHANGE,
    USN_REASON_RENAME_NEW_NAME, USN_REASON_RENAME_OLD_NAME, USN_REASON_REPARSE_POINT_CHANGE,
    USN_RECORD_V2,
};

use super::super::journal_batch::JournalChangeKind;

const REBUILD_REASONS: u32 = USN_REASON_HARD_LINK_CHANGE | USN_REASON_REPARSE_POINT_CHANGE;
pub(super) const RECORD_MAJOR_VERSION: u16 = 2;
pub(super) const PATH_CHANGE_REASONS: u32 = REBUILD_REASONS
    | USN_REASON_FILE_CREATE
    | USN_REASON_FILE_DELETE
    | USN_REASON_RENAME_OLD_NAME
    | USN_REASON_RENAME_NEW_NAME;
pub(super) const MAX_CHANGE_RECORDS: usize = 512;
const RECORD_HEADER_SIZE: usize = mem::offset_of!(USN_RECORD_V2, FileName);
const FILE_NAME_LENGTH_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, FileNameLength);
const FILE_NAME_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, FileNameOffset);
const FILE_ID_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, FileReferenceNumber);
const PARENT_ID_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, ParentFileReferenceNumber);
const USN_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, Usn);
const REASON_OFFSET: usize = mem::offset_of!(USN_RECORD_V2, Reason);

#[derive(Debug, Eq, PartialEq)]
pub(super) struct NameChange {
    pub(super) parent_file_id: u64,
    pub(super) name: String,
    pub(super) kind: JournalChangeKind,
}

pub(super) fn collect_batch(
    buffer: &[u8],
    start_usn: i64,
    stop_usn: i64,
    changes: &mut Vec<NameChange>,
) -> Result<i64, ()> {
    let next_usn = i64::from_le_bytes(read_field(buffer, 0)?);
    if next_usn <= start_usn {
        return Err(());
    }

    let mut records = &buffer[mem::size_of::<i64>()..];
    let mut previous_usn = None;
    while !records.is_empty() {
        let length = u32::from_le_bytes(read_field(records, 0)?) as usize;
        if length < RECORD_HEADER_SIZE || length % 8 != 0 {
            return Err(());
        }
        let record = records.get(..length).ok_or(())?;
        // Other major versions use different file identifiers and offsets.
        // Treat those records as a reason to rescan instead of skipping them.
        if u16::from_le_bytes(read_field(record, 4)?) != RECORD_MAJOR_VERSION {
            return Err(());
        }

        let usn = i64::from_le_bytes(read_field(record, USN_OFFSET)?);
        if usn < start_usn || usn >= next_usn || previous_usn.is_some_and(|last| usn <= last) {
            return Err(());
        }
        if usn >= stop_usn {
            // Changes made during this check belong to the next replay.
            break;
        }
        previous_usn = Some(usn);
        records = &records[length..];

        let reason = u32::from_le_bytes(read_field(record, REASON_OFFSET)?);
        if reason & PATH_CHANGE_REASONS == 0 {
            continue;
        }
        if changes.len() >= MAX_CHANGE_RECORDS {
            // Start the next read at this record, even if more records fit
            // in the kernel buffer. The header cursor skips the whole buffer.
            return Ok(usn);
        }
        if reason & REBUILD_REASONS != 0 {
            return Err(());
        }
        let file_id = u64::from_le_bytes(read_field(record, FILE_ID_OFFSET)?);
        // Reasons can accumulate while an item is open. A record reporting
        // both rename flags describes the current (new) name.
        let kind = if reason & USN_REASON_RENAME_NEW_NAME != 0 {
            JournalChangeKind::RenameNew(file_id)
        } else if reason & USN_REASON_RENAME_OLD_NAME != 0 {
            JournalChangeKind::RenameOld(file_id)
        } else {
            JournalChangeKind::Path
        };
        changes.push(NameChange {
            parent_file_id: u64::from_le_bytes(read_field(record, PARENT_ID_OFFSET)?),
            name: read_name(record)?,
            kind,
        });
    }

    Ok(next_usn.min(stop_usn))
}

fn read_field<const N: usize>(buffer: &[u8], offset: usize) -> Result<[u8; N], ()> {
    buffer
        .get(offset..offset + N)
        .and_then(|value| value.try_into().ok())
        .ok_or(())
}

fn read_name(record: &[u8]) -> Result<String, ()> {
    let start = u16::from_le_bytes(read_field(record, FILE_NAME_OFFSET)?) as usize;
    let length = u16::from_le_bytes(read_field(record, FILE_NAME_LENGTH_OFFSET)?) as usize;
    if start < RECORD_HEADER_SIZE || start % 2 != 0 || length % 2 != 0 {
        return Err(());
    }
    let bytes = record.get(start..start + length).ok_or(())?;
    let utf16 = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect::<Vec<_>>();
    let name = String::from_utf16(&utf16).map_err(|_| ())?;
    if !plain_component(&name) {
        return Err(());
    }
    Ok(name)
}

pub(super) fn join_volume_path(root: &str, parent: &str, name: &str) -> Option<String> {
    let [letter, b':', b'\\'] = root.as_bytes() else {
        return None;
    };
    if !letter.is_ascii_alphabetic() || !plain_component(name) {
        return None;
    }
    let relative = parent.strip_prefix('\\')?;
    if relative.is_empty() {
        return Some(format!("{root}{name}"));
    }
    if !relative.split('\\').all(plain_component) {
        return None;
    }
    Some(format!("{root}{relative}\\{name}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::System::Ioctl::{USN_REASON_CLOSE, USN_REASON_DATA_OVERWRITE};

    fn record(reason: u32, file_id: u64, parent: u64, usn: i64, name: &str) -> Vec<u8> {
        let utf16 = name.encode_utf16().collect::<Vec<_>>();
        let mut record = vec![0; (RECORD_HEADER_SIZE + utf16.len() * 2).next_multiple_of(8)];
        let length = record.len() as u32;
        record[..4].copy_from_slice(&length.to_le_bytes());
        record[4..6].copy_from_slice(&RECORD_MAJOR_VERSION.to_le_bytes());
        record[FILE_ID_OFFSET..FILE_ID_OFFSET + 8].copy_from_slice(&file_id.to_le_bytes());
        record[PARENT_ID_OFFSET..PARENT_ID_OFFSET + 8].copy_from_slice(&parent.to_le_bytes());
        record[USN_OFFSET..USN_OFFSET + 8].copy_from_slice(&usn.to_le_bytes());
        record[REASON_OFFSET..REASON_OFFSET + 4].copy_from_slice(&reason.to_le_bytes());
        record[FILE_NAME_LENGTH_OFFSET..FILE_NAME_LENGTH_OFFSET + 2]
            .copy_from_slice(&((utf16.len() * 2) as u16).to_le_bytes());
        record[FILE_NAME_OFFSET..FILE_NAME_OFFSET + 2]
            .copy_from_slice(&(RECORD_HEADER_SIZE as u16).to_le_bytes());
        for (index, code) in utf16.into_iter().enumerate() {
            let start = RECORD_HEADER_SIZE + index * 2;
            record[start..start + 2].copy_from_slice(&code.to_le_bytes());
        }
        record
    }

    #[test]
    fn reads_both_rename_paths_and_stops_at_captured_boundary() {
        let mut buffer = 2_000i64.to_le_bytes().to_vec();
        buffer.extend(record(USN_REASON_DATA_OVERWRITE, 11, 4, 500, "ignored"));
        buffer.extend(record(USN_REASON_RENAME_OLD_NAME, 12, 4, 600, "old.txt"));
        buffer.extend(record(USN_REASON_RENAME_NEW_NAME, 12, 5, 700, "new.txt"));
        buffer.extend(record(USN_REASON_FILE_CREATE, 13, 5, 1_500, "later.txt"));
        let mut changes = Vec::new();
        assert_eq!(collect_batch(&buffer, 200, 1_500, &mut changes), Ok(1_500));
        assert_eq!(
            changes,
            [
                NameChange {
                    parent_file_id: 4,
                    name: "old.txt".to_string(),
                    kind: JournalChangeKind::RenameOld(12),
                },
                NameChange {
                    parent_file_id: 5,
                    name: "new.txt".to_string(),
                    kind: JournalChangeKind::RenameNew(12),
                },
            ]
        );
    }

    #[test]
    fn rejects_unusable_or_incomplete_journal_reads() {
        for (version, reason) in [
            (2, USN_REASON_HARD_LINK_CHANGE),
            (2, USN_REASON_REPARSE_POINT_CHANGE),
            (3, USN_REASON_FILE_DELETE),
        ] {
            let mut buffer = 1_000i64.to_le_bytes().to_vec();
            let mut entry = record(reason, 11, 1, 500, "file.txt");
            entry[4..6].copy_from_slice(&u16::to_le_bytes(version));
            buffer.extend(entry);
            assert!(collect_batch(&buffer, 200, 1_000, &mut Vec::new()).is_err());
        }
        let mut malformed = 1_000i64.to_le_bytes().to_vec();
        malformed.extend(record(USN_REASON_FILE_DELETE, 11, 1, 500, "file.txt"));
        malformed.pop();
        assert!(collect_batch(&malformed, 200, 1_000, &mut Vec::new()).is_err());
        assert!(collect_batch(&200i64.to_le_bytes(), 200, 1_000, &mut Vec::new()).is_err());
    }

    #[test]
    fn paths_are_rooted_on_the_same_volume() {
        assert_eq!(
            join_volume_path(r"C:\", r"\", "file.txt").as_deref(),
            Some(r"C:\file.txt")
        );
        assert_eq!(
            join_volume_path(r"Q:\", r"\one\two", "name.txt").as_deref(),
            Some(r"Q:\one\two\name.txt")
        );
        assert!(join_volume_path(r"Q:\", r"\one\..", "name.txt").is_none());
        assert!(join_volume_path(r"Q:\", r"R:\one", "name.txt").is_none());
        assert!(join_volume_path(r"Q:\", r"\one", "two\\name.txt").is_none());
        assert!(join_volume_path(r"Q:\", r"\one", "NuL.txt").is_none());
        assert!(join_volume_path(r"Q:\", r"\one", "LPT².txt").is_none());
    }

    #[test]
    fn oversized_backlog_resumes_at_the_first_omitted_record() {
        let count = 2 * MAX_CHANGE_RECORDS + 7;
        let usn = |index: usize| 200 + index as i64 * 128;
        let records: Vec<_> = (0..count)
            .map(|index| {
                record(
                    USN_REASON_FILE_CREATE,
                    index as u64,
                    1,
                    usn(index),
                    &format!("entry{index}"),
                )
            })
            .collect();
        let mut cursor = usn(0);
        let mut applied = Vec::new();
        for start in (0..count).step_by(MAX_CHANGE_RECORDS) {
            // Emulate the kernel honoring StartUsn on every request. It can
            // return more records than the catalog will accept in one write.
            assert_eq!(cursor, usn(start));
            let end = count.min(start + MAX_CHANGE_RECORDS + 5);
            let mut buffer = usn(end).to_le_bytes().to_vec();
            buffer.extend(records[start..end].iter().flatten().copied());
            let mut changes = Vec::new();
            cursor = collect_batch(&buffer, cursor, usn(count), &mut changes).unwrap();
            assert_eq!(changes.len(), MAX_CHANGE_RECORDS.min(count - start));
            applied.extend(changes.into_iter().map(|change| change.name));
        }
        assert_eq!(cursor, usn(count));
        assert_eq!(
            applied,
            (0..count)
                .map(|index| format!("entry{index}"))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn case_only_rename_keeps_both_spellings_and_file_id_across_limits() {
        let mut first_read = 100_000i64.to_le_bytes().to_vec();
        for index in 0..MAX_CHANGE_RECORDS - 1 {
            first_read.extend(record(
                USN_REASON_FILE_CREATE,
                10,
                1,
                200 + index as i64 * 128,
                "repeated.txt",
            ));
        }
        let mut changes = Vec::new();
        assert_eq!(
            collect_batch(&first_read, 200, 101_000, &mut changes),
            Ok(100_000)
        );
        assert_eq!(changes.len(), MAX_CHANGE_RECORDS - 1);

        let mut second_read = 101_000i64.to_le_bytes().to_vec();
        second_read.extend(record(USN_REASON_RENAME_OLD_NAME, 42, 7, 100_000, "Report"));
        // A close record can carry accumulated rename reasons for the new spelling.
        let new_name = record(
            USN_REASON_RENAME_OLD_NAME | USN_REASON_RENAME_NEW_NAME | USN_REASON_CLOSE,
            42,
            7,
            100_128,
            "REPORT",
        );
        second_read.extend_from_slice(&new_name);
        let resume = collect_batch(&second_read, 100_000, 101_000, &mut changes).unwrap();
        assert_eq!(resume, 100_128);
        assert_eq!(changes.len(), MAX_CHANGE_RECORDS);
        assert_eq!(
            changes.last(),
            Some(&NameChange {
                parent_file_id: 7,
                name: "Report".into(),
                kind: JournalChangeKind::RenameOld(42),
            })
        );

        let mut resumed_read = 101_000i64.to_le_bytes().to_vec();
        resumed_read.extend(new_name);
        let mut resumed = Vec::new();
        assert_eq!(
            collect_batch(&resumed_read, resume, 101_000, &mut resumed),
            Ok(101_000)
        );
        assert_eq!(
            resumed,
            [NameChange {
                parent_file_id: 7,
                name: "REPORT".into(),
                kind: JournalChangeKind::RenameNew(42),
            }]
        );
    }
}
