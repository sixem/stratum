// Windows-only helpers for interacting with the Recycle Bin.
use super::RecycleEntry;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::GetDriveTypeW;

const DRIVE_FIXED: u32 = 3;

fn to_wide_double_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain([0, 0]).collect()
}

fn drive_root(path: &str) -> Option<String> {
    if path.starts_with("\\\\") {
        let mut parts = path.trim_start_matches("\\\\").split('\\');
        let server = parts.next()?;
        let share = parts.next()?;
        return Some(format!("\\\\{}\\{}\\", server, share));
    }
    if path.len() >= 2 && path.as_bytes()[1] == b':' {
        return Some(format!("{}\\", &path[..2]));
    }
    None
}

pub(crate) fn can_use_recycle_bin(path: &Path) -> bool {
    // Recycle Bin is only reliable on fixed local drives.
    let path_str = path.to_string_lossy();
    let root = match drive_root(&path_str) {
        Some(value) => value,
        None => return false,
    };
    if root.starts_with("\\\\") {
        return false;
    }
    let wide = to_wide_double_null(&root);
    let drive_type = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
    drive_type == DRIVE_FIXED
}

fn filetime_to_epoch_ms(filetime: u64) -> Option<u64> {
    const FILETIME_EPOCH: u64 = 116_444_736_000_000_000;
    if filetime < FILETIME_EPOCH {
        return None;
    }
    Some((filetime - FILETIME_EPOCH) / 10_000)
}

pub(crate) fn normalize_path_ci(value: &str) -> String {
    let mut normalized = value.trim().replace('/', "\\");
    // Recycle metadata may use extended path prefixes while UI paths do not.
    if normalized.starts_with("\\\\?\\UNC\\") && normalized.len() > 8 {
        normalized = format!("\\\\{}", &normalized[8..]);
    } else if (normalized.starts_with("\\\\?\\") || normalized.starts_with("\\??\\"))
        && normalized.len() > 4
    {
        normalized = normalized[4..].to_string();
    }
    // Trim trailing separators for non-root paths.
    while normalized.ends_with('\\')
        && !normalized.ends_with(":\\")
        && normalized != "\\"
        && !normalized.starts_with("\\\\")
    {
        normalized.pop();
    }
    normalized.to_lowercase()
}

fn normalized_path_is_same_or_within(path: &str, root: &str) -> bool {
    if path == root {
        return true;
    }

    let mut prefix = root.to_string();
    if !prefix.ends_with('\\') {
        prefix.push('\\');
    }
    path.starts_with(&prefix)
}

fn parse_utf16_until_nul(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 2 {
        return None;
    }
    let mut utf16 = Vec::with_capacity(bytes.len() / 2);
    let mut index = 0;
    while index + 1 < bytes.len() {
        let value = u16::from_le_bytes([bytes[index], bytes[index + 1]]);
        if value == 0 {
            break;
        }
        utf16.push(value);
        index += 2;
    }
    if utf16.is_empty() {
        return None;
    }
    Some(String::from_utf16_lossy(&utf16))
}

fn parse_recycle_info(info_path: &Path) -> Option<(String, Option<u64>)> {
    let mut file = fs::File::open(info_path).ok()?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).ok()?;
    if buffer.len() < 24 {
        return None;
    }
    let header = u64::from_le_bytes(buffer[0..8].try_into().ok()?);
    let deleted_raw = u64::from_le_bytes(buffer[16..24].try_into().ok()?);
    let deleted_at = filetime_to_epoch_ms(deleted_raw);
    // Windows uses at least two known formats:
    // v1: path starts at byte 24 (fixed-width record)
    // v2: u32 UTF-16 char length at byte 24, path starts at byte 28
    let original_path = if header == 2 && buffer.len() >= 28 {
        let char_len = u32::from_le_bytes(buffer[24..28].try_into().ok()?) as usize;
        let byte_len = char_len.saturating_mul(2);
        let available = buffer.len().saturating_sub(28);
        let take = available.min(byte_len);
        parse_utf16_until_nul(&buffer[28..28 + take])
            .or_else(|| parse_utf16_until_nul(&buffer[28..]))
    } else {
        parse_utf16_until_nul(&buffer[24..])
    }?;
    if original_path.trim().is_empty() {
        return None;
    }
    Some((original_path, deleted_at))
}

fn list_recycle_entries_for_drive(root: &Path) -> Vec<RecycleEntry> {
    let mut entries = Vec::new();
    let recycle_root = root.join("$Recycle.Bin");
    let sid_dirs = match fs::read_dir(&recycle_root) {
        Ok(value) => value,
        Err(_) => return entries,
    };
    for sid in sid_dirs {
        let sid = match sid {
            Ok(value) => value,
            Err(_) => continue,
        };
        let sid_path = sid.path();
        if !sid_path.is_dir() {
            continue;
        }
        let items = match fs::read_dir(&sid_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for item in items {
            let item = match item {
                Ok(value) => value,
                Err(_) => continue,
            };
            let name = item.file_name().to_string_lossy().to_string();
            if !name.starts_with("$I") || name.len() < 3 {
                continue;
            }
            let info_path = item.path();
            let (original_path, deleted_at) = match parse_recycle_info(&info_path) {
                Some(value) => value,
                None => continue,
            };
            let data_name = format!("$R{}", &name[2..]);
            let data_path = info_path.parent().unwrap_or(&sid_path).join(data_name);
            entries.push(RecycleEntry {
                original_path,
                info_path: info_path.to_string_lossy().to_string(),
                data_path: data_path.to_string_lossy().to_string(),
                deleted_at,
            });
        }
    }
    entries
}

pub(crate) fn find_recycle_entries_for_paths(
    paths: &[String],
    min_deleted_at: Option<u64>,
) -> Vec<RecycleEntry> {
    let mut ordered_targets: Vec<String> = Vec::new();
    let mut targets = HashSet::new();
    let mut drive_roots = HashSet::new();
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = normalize_path_ci(trimmed);
        if targets.insert(key.clone()) {
            ordered_targets.push(key);
        }
        if let Some(root) = drive_root(trimmed) {
            drive_roots.insert(root);
        }
    }
    let mut matched: HashMap<String, RecycleEntry> = HashMap::new();
    for root in drive_roots {
        let entries = list_recycle_entries_for_drive(Path::new(&root));
        for entry in entries {
            let key = normalize_path_ci(&entry.original_path);
            if !targets.contains(&key) {
                continue;
            }
            if let (Some(min), Some(deleted_at)) = (min_deleted_at, entry.deleted_at) {
                if deleted_at < min {
                    continue;
                }
            }
            let replace = match matched.get(&key) {
                None => true,
                Some(existing) => match (existing.deleted_at, entry.deleted_at) {
                    (Some(left), Some(right)) => right > left,
                    (None, Some(_)) => true,
                    _ => false,
                },
            };
            if replace {
                matched.insert(key, entry);
            }
        }
    }
    let mut ordered = Vec::new();
    for key in ordered_targets {
        if let Some(entry) = matched.remove(&key) {
            ordered.push(entry);
        }
    }
    ordered
}

pub(crate) fn find_recycle_entries_within_paths(
    paths: &[String],
    min_deleted_at: Option<u64>,
) -> Vec<RecycleEntry> {
    let mut ordered_roots: Vec<String> = Vec::new();
    let mut root_keys = HashSet::new();
    let mut drive_roots = HashSet::new();
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = normalize_path_ci(trimmed);
        if root_keys.insert(key.clone()) {
            ordered_roots.push(key);
        }
        if let Some(root) = drive_root(trimmed) {
            drive_roots.insert(root);
        }
    }

    let mut matched: HashMap<String, RecycleEntry> = HashMap::new();
    for root in drive_roots {
        let entries = list_recycle_entries_for_drive(Path::new(&root));
        for entry in entries {
            let key = normalize_path_ci(&entry.original_path);
            if !ordered_roots
                .iter()
                .any(|root_key| normalized_path_is_same_or_within(&key, root_key))
            {
                continue;
            }
            if let (Some(min), Some(deleted_at)) = (min_deleted_at, entry.deleted_at) {
                if deleted_at < min {
                    continue;
                }
            }
            let replace = match matched.get(&key) {
                None => true,
                Some(existing) => match (existing.deleted_at, entry.deleted_at) {
                    (Some(left), Some(right)) => right > left,
                    (None, Some(_)) => true,
                    _ => false,
                },
            };
            if replace {
                matched.insert(key, entry);
            }
        }
    }

    let mut ordered = Vec::new();
    for root_key in ordered_roots {
        let mut child_keys: Vec<String> = matched
            .keys()
            .filter(|key| normalized_path_is_same_or_within(key, &root_key))
            .cloned()
            .collect();
        child_keys.sort();
        for key in child_keys {
            if let Some(entry) = matched.remove(&key) {
                ordered.push(entry);
            }
        }
    }
    ordered
}

#[cfg(test)]
mod tests {
    use super::{normalize_path_ci, normalized_path_is_same_or_within};

    #[test]
    fn normalized_path_matching_requires_separator_boundaries() {
        let root = normalize_path_ci(r"C:\Data\Season 4");
        let child = normalize_path_ci(r"C:\Data\Season 4\Episode 1.mkv");
        let sibling = normalize_path_ci(r"C:\Data\Season 40\Episode 1.mkv");

        assert!(normalized_path_is_same_or_within(&root, &root));
        assert!(normalized_path_is_same_or_within(&child, &root));
        assert!(!normalized_path_is_same_or_within(&sibling, &root));
    }
}
