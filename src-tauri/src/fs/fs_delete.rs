// Hard-delete helpers for permanently removing filesystem entries.
use super::DeleteReport;
use std::fs;
use std::path::PathBuf;

pub fn delete_entries(paths: Vec<String>) -> Result<DeleteReport, String> {
    let mut report = DeleteReport {
        deleted: 0,
        skipped: 0,
        failures: Vec::new(),
    };

    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            report.skipped += 1;
            continue;
        }
        let target = PathBuf::from(trimmed);
        let metadata = match fs::metadata(&target) {
            Ok(value) => value,
            Err(err) => {
                report
                    .failures
                    .push(format!("{}: {}", trimmed, err.to_string()));
                continue;
            }
        };
        let hard_delete = || {
            if metadata.is_dir() {
                fs::remove_dir_all(&target)
            } else {
                fs::remove_file(&target)
            }
        };
        match hard_delete() {
            Ok(_) => report.deleted += 1,
            Err(err) => report
                .failures
                .push(format!("{}: {}", trimmed, err.to_string())),
        }
    }

    Ok(report)
}
