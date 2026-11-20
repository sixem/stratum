// Check all planned names before publishing the first item in a batch. Each
// conversion may replace its own input, but must leave the other inputs usable.
use super::ConversionJobItem;
use crate::domain::filesystem::transfer::normalize_path_key;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

fn path_key(path: &str) -> String {
    let path = Path::new(path.trim());
    // Resolve existing links and alternate spellings. New outputs can still
    // share a directory reached through a junction.
    let resolved = fs::canonicalize(path).ok().or_else(|| {
        let parent = fs::canonicalize(path.parent()?).ok()?;
        Some(parent.join(path.file_name()?))
    });
    normalize_path_key(resolved.as_deref().unwrap_or(path))
}

pub(super) fn validate_paths(items: &[ConversionJobItem]) -> Result<(), String> {
    let mut sources = HashMap::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        if sources
            .insert(path_key(item.source_path()), index)
            .is_some()
        {
            return Err(format!(
                "Source appears more than once in the batch: {}",
                item.source_path()
            ));
        }
    }
    let mut outputs = HashSet::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let output = path_key(item.destination_path());
        if let Some(&source_index) = sources.get(&output) {
            if source_index != index {
                return Err(format!(
                    "Output would replace another selected input: {}",
                    item.destination_path()
                ));
            }
            if item.delete_source_after_success() || !item.overwrite() {
                return Err(format!(
                    "Choose a new output name or replace the input in place: {}",
                    item.destination_path()
                ));
            }
        }
        if !outputs.insert(output) {
            return Err(format!(
                "Multiple conversions would write to the same output: {}",
                item.destination_path()
            ));
        }
    }
    Ok(())
}
