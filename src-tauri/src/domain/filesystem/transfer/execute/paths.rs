// Preserve lookup errors when deciding if a transfer needs permission to replace an item.
use super::super::common::{transfer_entry_kind, TransferEntryKind};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

pub(super) fn existing_entry_kind(path: &Path) -> Result<Option<TransferEntryKind>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(transfer_entry_kind(path, &metadata))),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
