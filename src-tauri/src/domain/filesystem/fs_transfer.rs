// Copy/move helpers with optional per-item progress reporting.
use super::{
    CopyReport, TransferMode, TransferOptions, TransferProgressCallback, TransferProgressUpdate,
    TransferReport,
};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn unique_destination(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = match path.parent() {
        Some(parent) => parent,
        None => return path.to_path_buf(),
    };
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("item");
    let ext = path.extension().and_then(|value| value.to_str());

    for index in 1..=10_000 {
        let candidate = match ext {
            Some(ext) => format!("{} ({}).{}", stem, index, ext),
            None => format!("{} ({})", stem, index),
        };
        let candidate_path = parent.join(candidate);
        if !candidate_path.exists() {
            return candidate_path;
        }
    }

    path.to_path_buf()
}

// Chunk size for streaming file copies while emitting progress updates.
const COPY_CHUNK_SIZE: usize = 1024 * 1024;

fn emit_transfer_progress(
    callback: &mut Option<&mut TransferProgressCallback>,
    update: TransferProgressUpdate,
) {
    if let Some(handler) = callback.as_mut() {
        handler(update);
    }
}

fn copy_file_with_progress(
    src: &Path,
    dest: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) -> Result<(), String> {
    if on_progress.is_none() {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        fs::copy(src, dest).map_err(|err| err.to_string())?;
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let mut reader = fs::File::open(src).map_err(|err| err.to_string())?;
    let mut writer = fs::File::create(dest).map_err(|err| err.to_string())?;
    let total_bytes = reader.metadata().map_err(|err| err.to_string())?.len();
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: Some(src.to_string_lossy().to_string()),
            current_bytes: Some(0),
            current_total_bytes: Some(total_bytes),
        },
    );

    let mut copied: u64 = 0;
    let mut buffer = vec![0u8; COPY_CHUNK_SIZE];
    loop {
        let bytes = reader.read(&mut buffer).map_err(|err| err.to_string())?;
        if bytes == 0 {
            break;
        }
        writer
            .write_all(&buffer[..bytes])
            .map_err(|err| err.to_string())?;
        copied = copied.saturating_add(bytes as u64);
        emit_transfer_progress(
            on_progress,
            TransferProgressUpdate {
                processed,
                total,
                current_path: None,
                current_bytes: Some(copied),
                current_total_bytes: Some(total_bytes),
            },
        );
    }

    if let Ok(metadata) = fs::metadata(src) {
        let _ = fs::set_permissions(dest, metadata.permissions());
    }
    Ok(())
}

fn copy_dir(
    src: &Path,
    dest: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) -> Result<(), String> {
    if on_progress.is_none() {
        fs::create_dir_all(dest).map_err(|err| err.to_string())?;
        for entry in fs::read_dir(src).map_err(|err| err.to_string())? {
            let entry = entry.map_err(|err| err.to_string())?;
            let src_path = entry.path();
            let dest_path = dest.join(entry.file_name());
            let metadata = entry.metadata().map_err(|err| err.to_string())?;
            if metadata.is_dir() {
                copy_dir(&src_path, &dest_path, processed, total, on_progress)?;
            } else {
                fs::copy(&src_path, &dest_path).map_err(|err| err.to_string())?;
            }
        }
        return Ok(());
    }
    fs::create_dir_all(dest).map_err(|err| err.to_string())?;
    emit_transfer_progress(
        on_progress,
        TransferProgressUpdate {
            processed,
            total,
            current_path: Some(src.to_string_lossy().to_string()),
            current_bytes: None,
            current_total_bytes: None,
        },
    );
    for entry in fs::read_dir(src).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_dir() {
            copy_dir(&src_path, &dest_path, processed, total, on_progress)?;
        } else {
            copy_file_with_progress(&src_path, &dest_path, processed, total, on_progress)?;
        }
    }
    Ok(())
}

fn copy_path(
    src: &Path,
    dest: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) -> Result<(), String> {
    let metadata = fs::metadata(src).map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        return copy_dir(src, dest, processed, total, on_progress);
    }
    copy_file_with_progress(src, dest, processed, total, on_progress)
}

pub fn copy_entries(
    paths: Vec<String>,
    destination: String,
    mut on_progress: Option<&mut TransferProgressCallback>,
) -> Result<CopyReport, String> {
    let target = destination.trim();
    if target.is_empty() {
        return Err("Empty destination".to_string());
    }
    let target_path = PathBuf::from(target);
    if !target_path.exists() {
        return Err("Destination does not exist".to_string());
    }
    if !target_path.is_dir() {
        return Err("Destination is not a folder".to_string());
    }

    let mut report = CopyReport {
        copied: 0,
        skipped: 0,
        failures: Vec::new(),
    };

    let total = paths.len();
    for (index, path) in paths.into_iter().enumerate() {
        let processed = index;
        let completed = index + 1;
        let trimmed = path.trim();
        if trimmed.is_empty() {
            report.skipped += 1;
            emit_transfer_progress(
                &mut on_progress,
                TransferProgressUpdate {
                    processed: completed,
                    total,
                    current_path: None,
                    current_bytes: None,
                    current_total_bytes: None,
                },
            );
            continue;
        }
        let src = PathBuf::from(trimmed);
        let metadata = match fs::metadata(&src) {
            Ok(value) => value,
            Err(err) => {
                report
                    .failures
                    .push(format!("{}: {}", trimmed, err.to_string()));
                emit_transfer_progress(
                    &mut on_progress,
                    TransferProgressUpdate {
                        processed: completed,
                        total,
                        current_path: None,
                        current_bytes: None,
                        current_total_bytes: None,
                    },
                );
                continue;
            }
        };
        if metadata.is_dir() && target_path.starts_with(&src) {
            report
                .failures
                .push(format!("{}: destination is inside source", trimmed));
            emit_transfer_progress(
                &mut on_progress,
                TransferProgressUpdate {
                    processed: completed,
                    total,
                    current_path: None,
                    current_bytes: None,
                    current_total_bytes: None,
                },
            );
            continue;
        }
        let name = match src.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => {
                report.skipped += 1;
                emit_transfer_progress(
                    &mut on_progress,
                    TransferProgressUpdate {
                        processed: completed,
                        total,
                        current_path: None,
                        current_bytes: None,
                        current_total_bytes: None,
                    },
                );
                continue;
            }
        };
        let dest_path = unique_destination(&target_path.join(name));
        match copy_path(&src, &dest_path, processed, total, &mut on_progress) {
            Ok(_) => report.copied += 1,
            Err(err) => report.failures.push(format!("{}: {}", trimmed, err)),
        }
        emit_transfer_progress(
            &mut on_progress,
            TransferProgressUpdate {
                processed: completed,
                total,
                current_path: None,
                current_bytes: None,
                current_total_bytes: None,
            },
        );
    }

    Ok(report)
}

#[cfg(target_os = "windows")]
fn drive_key(path: &Path) -> Option<String> {
    use std::path::Component;
    use std::path::Prefix;

    let component = path.components().next()?;
    if let Component::Prefix(prefix) = component {
        return match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                Some(format!("{}:", char::from(letter).to_ascii_uppercase()))
            }
            Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => Some(format!(
                "\\\\{}\\{}",
                server.to_string_lossy(),
                share.to_string_lossy()
            )),
            _ => None,
        };
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn drive_key(path: &Path) -> Option<String> {
    if path.is_absolute() {
        Some("/".to_string())
    } else {
        None
    }
}

fn same_drive(left: &Path, right: &Path) -> bool {
    let left_key = drive_key(left);
    let right_key = drive_key(right);
    match (left_key, right_key) {
        (Some(l), Some(r)) => l.eq_ignore_ascii_case(&r),
        _ => false,
    }
}

fn remove_existing(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let result = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|err| err.to_string())
}

fn move_path(
    src: &Path,
    dest: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    match fs::rename(src, dest) {
        Ok(_) => Ok(()),
        Err(_) => {
            copy_path(src, dest, processed, total, on_progress)?;
            let cleanup = if src.is_dir() {
                fs::remove_dir_all(src)
            } else {
                fs::remove_file(src)
            };
            cleanup.map_err(|err| err.to_string())
        }
    }
}

// Transfers entries into a destination folder with optional overwrite.
// Auto mode moves within the same drive and copies across drives.
pub fn transfer_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<TransferOptions>,
    mut on_progress: Option<&mut TransferProgressCallback>,
) -> Result<TransferReport, String> {
    let target = destination.trim();
    if target.is_empty() {
        return Err("Empty destination".to_string());
    }
    let target_path = PathBuf::from(target);
    if !target_path.exists() {
        return Err("Destination does not exist".to_string());
    }
    if !target_path.is_dir() {
        return Err("Destination is not a folder".to_string());
    }

    let mode = options
        .as_ref()
        .and_then(|value| value.mode)
        .unwrap_or(TransferMode::Auto);
    let overwrite = options
        .as_ref()
        .and_then(|value| value.overwrite)
        .unwrap_or(false);

    let mut report = TransferReport {
        copied: 0,
        moved: 0,
        skipped: 0,
        failures: Vec::new(),
    };

    let total = paths.len();
    for (index, path) in paths.into_iter().enumerate() {
        let processed = index;
        let completed = index + 1;
        let trimmed = path.trim();
        if trimmed.is_empty() {
            report.skipped += 1;
            emit_transfer_progress(
                &mut on_progress,
                TransferProgressUpdate {
                    processed: completed,
                    total,
                    current_path: None,
                    current_bytes: None,
                    current_total_bytes: None,
                },
            );
            continue;
        }
        let src = PathBuf::from(trimmed);
        let metadata = match fs::metadata(&src) {
            Ok(value) => value,
            Err(err) => {
                report
                    .failures
                    .push(format!("{}: {}", trimmed, err.to_string()));
                emit_transfer_progress(
                    &mut on_progress,
                    TransferProgressUpdate {
                        processed: completed,
                        total,
                        current_path: None,
                        current_bytes: None,
                        current_total_bytes: None,
                    },
                );
                continue;
            }
        };
        if metadata.is_dir() && target_path.starts_with(&src) {
            report
                .failures
                .push(format!("{}: destination is inside source", trimmed));
            emit_transfer_progress(
                &mut on_progress,
                TransferProgressUpdate {
                    processed: completed,
                    total,
                    current_path: None,
                    current_bytes: None,
                    current_total_bytes: None,
                },
            );
            continue;
        }
        let name = match src.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => {
                report.skipped += 1;
                emit_transfer_progress(
                    &mut on_progress,
                    TransferProgressUpdate {
                        processed: completed,
                        total,
                        current_path: None,
                        current_bytes: None,
                        current_total_bytes: None,
                    },
                );
                continue;
            }
        };
        let dest_path = target_path.join(name);
        if dest_path.exists() {
            if overwrite {
                if let Err(err) = remove_existing(&dest_path) {
                    report
                        .failures
                        .push(format!("{}: {}", trimmed, err.to_string()));
                    emit_transfer_progress(
                        &mut on_progress,
                        TransferProgressUpdate {
                            processed: completed,
                            total,
                            current_path: None,
                            current_bytes: None,
                            current_total_bytes: None,
                        },
                    );
                    continue;
                }
            } else {
                report
                    .failures
                    .push(format!("{}: destination already exists", trimmed));
                emit_transfer_progress(
                    &mut on_progress,
                    TransferProgressUpdate {
                        processed: completed,
                        total,
                        current_path: None,
                        current_bytes: None,
                        current_total_bytes: None,
                    },
                );
                continue;
            }
        }

        let should_move = match mode {
            TransferMode::Copy => false,
            TransferMode::Move => true,
            TransferMode::Auto => same_drive(&src, &target_path),
        };

        let outcome = if should_move {
            move_path(&src, &dest_path, processed, total, &mut on_progress).map(|_| {
                report.moved += 1;
            })
        } else {
            copy_path(&src, &dest_path, processed, total, &mut on_progress).map(|_| {
                report.copied += 1;
            })
        };

        if let Err(err) = outcome {
            report
                .failures
                .push(format!("{}: {}", trimmed, err.to_string()));
        }
        emit_transfer_progress(
            &mut on_progress,
            TransferProgressUpdate {
                processed: completed,
                total,
                current_path: None,
                current_bytes: None,
                current_total_bytes: None,
            },
        );
    }

    Ok(report)
}
