// Trash/recycle helpers with Windows-specific recycle bin support.
use super::{RecycleEntry, RestoreReport, TrashReport};

#[cfg(target_os = "windows")]
use super::fs_recycle_windows::{
    can_use_recycle_bin, delete_to_recycle_bin, find_recycle_entries_for_paths,
};
#[cfg(target_os = "windows")]
use std::fs;
#[cfg(target_os = "windows")]
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::time::SystemTime;

#[cfg(target_os = "windows")]
pub fn trash_entries(paths: Vec<String>) -> Result<TrashReport, String> {
    let mut report = TrashReport {
        deleted: 0,
        skipped: 0,
        failures: Vec::new(),
        failed_paths: Vec::new(),
        recycled: Vec::new(),
    };
    let mut recycled_paths: Vec<String> = Vec::new();
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            report.skipped += 1;
            continue;
        }
        let target = PathBuf::from(trimmed);
        if !can_use_recycle_bin(&target) {
            report
                .failures
                .push(format!("{}: Recycle Bin unavailable", trimmed));
            report.failed_paths.push(trimmed.to_string());
            continue;
        }
        match delete_to_recycle_bin(&target) {
            Ok(_) => {
                report.deleted += 1;
                recycled_paths.push(trimmed.to_string());
            }
            Err(err) => {
                report.failures.push(format!("{}: {}", trimmed, err));
                report.failed_paths.push(trimmed.to_string());
            }
        }
    }
    let min_deleted_at = super::to_epoch_ms(SystemTime::now())
        .map(|value| value.saturating_sub(300_000));
    report.recycled = find_recycle_entries_for_paths(&recycled_paths, min_deleted_at);
    Ok(report)
}

#[cfg(not(target_os = "windows"))]
pub fn trash_entries(_paths: Vec<String>) -> Result<TrashReport, String> {
    Err("Native trash is only supported on Windows.".to_string())
}

#[cfg(target_os = "windows")]
pub fn restore_recycle_entries(entries: Vec<RecycleEntry>) -> Result<RestoreReport, String> {
    let mut report = RestoreReport {
        restored: 0,
        skipped: 0,
        failures: Vec::new(),
        remaining: Vec::new(),
    };
    for entry in entries {
        let original = entry.original_path.trim().to_string();
        let data = entry.data_path.trim().to_string();
        let info = entry.info_path.trim().to_string();
        if original.is_empty() || data.is_empty() {
            report.skipped += 1;
            continue;
        }
        let original_path = PathBuf::from(&original);
        if original_path.exists() {
            report
                .failures
                .push(format!("{}: destination already exists", original));
            report.remaining.push(entry);
            continue;
        }
        if let Some(parent) = original_path.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                report
                    .failures
                    .push(format!("{}: {}", original, err.to_string()));
                report.remaining.push(entry);
                continue;
            }
        }
        let data_path = PathBuf::from(&data);
        if !data_path.exists() {
            report
                .failures
                .push(format!("{}: recycle entry missing", original));
            report.remaining.push(entry);
            continue;
        }
        match fs::rename(&data_path, &original_path) {
            Ok(_) => {
                report.restored += 1;
                if !info.is_empty() {
                    let _ = fs::remove_file(info);
                }
            }
            Err(err) => {
                report
                    .failures
                    .push(format!("{}: {}", original, err.to_string()));
                report.remaining.push(entry);
            }
        }
    }
    Ok(report)
}

#[cfg(not(target_os = "windows"))]
pub fn restore_recycle_entries(_entries: Vec<RecycleEntry>) -> Result<RestoreReport, String> {
    Err("Recycle restore is only supported on Windows.".to_string())
}
