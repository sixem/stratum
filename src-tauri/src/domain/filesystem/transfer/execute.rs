// Transfer execution for copy and move operations.
// Keeps the file-operation loops readable while progress and conflict behavior stay centralized.
use super::common::{
    build_copy_decision_sets, check_transfer_control, emit_transfer_progress,
    is_same_directory_copy, remove_existing, same_drive, should_overwrite_copy_destination,
    should_skip_copy_destination, unique_destination, CopyDecisionSets, CopyExecution,
    COPY_CHUNK_SIZE,
};
use crate::domain::filesystem::{
    CopyOptions, CopyReport, TransferControlCallback, TransferMode, TransferOptions,
    TransferProgressCallback, TransferProgressUpdate, TransferReport,
};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn copy_file_with_progress(
    src: &Path,
    dest: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    check_transfer_control(on_control)?;
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
        check_transfer_control(on_control)?;
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
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    check_transfer_control(on_control)?;
    if on_progress.is_none() {
        fs::create_dir_all(dest).map_err(|err| err.to_string())?;
        for entry in fs::read_dir(src).map_err(|err| err.to_string())? {
            check_transfer_control(on_control)?;
            let entry = entry.map_err(|err| err.to_string())?;
            let src_path = entry.path();
            let dest_path = dest.join(entry.file_name());
            let metadata = entry.metadata().map_err(|err| err.to_string())?;
            if metadata.is_dir() {
                copy_dir(
                    &src_path,
                    &dest_path,
                    processed,
                    total,
                    on_progress,
                    on_control,
                )?;
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
        check_transfer_control(on_control)?;
        let entry = entry.map_err(|err| err.to_string())?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        let metadata = entry.metadata().map_err(|err| err.to_string())?;
        if metadata.is_dir() {
            copy_dir(
                &src_path,
                &dest_path,
                processed,
                total,
                on_progress,
                on_control,
            )?;
        } else {
            copy_file_with_progress(
                &src_path,
                &dest_path,
                processed,
                total,
                on_progress,
                on_control,
            )?;
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
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    check_transfer_control(on_control)?;
    let metadata = fs::metadata(src).map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        return copy_dir(src, dest, processed, total, on_progress, on_control);
    }
    copy_file_with_progress(src, dest, processed, total, on_progress, on_control)
}

fn copy_file_with_decisions(
    src: &Path,
    dest: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
    decisions: &CopyDecisionSets,
) -> Result<CopyExecution, String> {
    check_transfer_control(on_control)?;
    if dest.exists() {
        if should_skip_copy_destination(dest, decisions) {
            return Ok(CopyExecution {
                copied_root: false,
                skipped: 1,
            });
        }
        if should_overwrite_copy_destination(dest, decisions) {
            remove_existing(dest)?;
        } else {
            return Err("destination already exists".to_string());
        }
    }

    copy_file_with_progress(src, dest, processed, total, on_progress, on_control)?;
    Ok(CopyExecution {
        copied_root: true,
        skipped: 0,
    })
}

fn copy_dir_with_decisions(
    src: &Path,
    dest: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
    decisions: &CopyDecisionSets,
) -> Result<CopyExecution, String> {
    check_transfer_control(on_control)?;
    if dest.exists() {
        let metadata = fs::metadata(dest).map_err(|err| err.to_string())?;
        if !metadata.is_dir() {
            if should_skip_copy_destination(dest, decisions) {
                return Ok(CopyExecution {
                    copied_root: false,
                    skipped: 1,
                });
            }
            if should_overwrite_copy_destination(dest, decisions) {
                remove_existing(dest)?;
            } else {
                return Err("destination already exists".to_string());
            }
        }
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

    let mut skipped = 0;
    for entry in fs::read_dir(src).map_err(|err| err.to_string())? {
        check_transfer_control(on_control)?;
        let entry = entry.map_err(|err| err.to_string())?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        let outcome = copy_path_with_decisions(
            &src_path,
            &dest_path,
            processed,
            total,
            on_progress,
            on_control,
            decisions,
        )?;
        skipped += outcome.skipped;
    }

    Ok(CopyExecution {
        copied_root: true,
        skipped,
    })
}

fn copy_path_with_decisions(
    src: &Path,
    dest: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
    decisions: &CopyDecisionSets,
) -> Result<CopyExecution, String> {
    check_transfer_control(on_control)?;
    let metadata = fs::metadata(src).map_err(|err| err.to_string())?;
    if metadata.is_dir() {
        return copy_dir_with_decisions(
            src,
            dest,
            processed,
            total,
            on_progress,
            on_control,
            decisions,
        );
    }
    copy_file_with_decisions(
        src,
        dest,
        processed,
        total,
        on_progress,
        on_control,
        decisions,
    )
}

fn move_path(
    src: &Path,
    dest: &Path,
    processed: usize,
    total: usize,
    on_progress: &mut Option<&mut TransferProgressCallback>,
    on_control: &mut Option<&mut TransferControlCallback>,
) -> Result<(), String> {
    check_transfer_control(on_control)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    match fs::rename(src, dest) {
        Ok(_) => Ok(()),
        Err(_) => {
            copy_path(src, dest, processed, total, on_progress, on_control)?;
            check_transfer_control(on_control)?;
            let cleanup = if src.is_dir() {
                fs::remove_dir_all(src)
            } else {
                fs::remove_file(src)
            };
            cleanup.map_err(|err| err.to_string())
        }
    }
}

pub fn copy_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<CopyOptions>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
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
    let decisions = build_copy_decision_sets(options.as_ref());

    let total = paths.len();
    for (index, path) in paths.into_iter().enumerate() {
        check_transfer_control(&mut on_control)?;
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
        let default_dest = target_path.join(name);
        let dest_path = if is_same_directory_copy(&src, &target_path) {
            unique_destination(&default_dest)
        } else {
            default_dest
        };
        match copy_path_with_decisions(
            &src,
            &dest_path,
            processed,
            total,
            &mut on_progress,
            &mut on_control,
            &decisions,
        ) {
            Ok(outcome) => {
                if outcome.copied_root {
                    report.copied += 1;
                }
                report.skipped += outcome.skipped;
            }
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

// Transfers entries into a destination folder with optional overwrite.
// Auto mode moves within the same drive and copies across drives.
pub fn transfer_entries(
    paths: Vec<String>,
    destination: String,
    options: Option<TransferOptions>,
    mut on_progress: Option<&mut TransferProgressCallback>,
    mut on_control: Option<&mut TransferControlCallback>,
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
        check_transfer_control(&mut on_control)?;
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
            move_path(
                &src,
                &dest_path,
                processed,
                total,
                &mut on_progress,
                &mut on_control,
            )
            .map(|_| {
                report.moved += 1;
            })
        } else {
            copy_path(
                &src,
                &dest_path,
                processed,
                total,
                &mut on_progress,
                &mut on_control,
            )
            .map(|_| {
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
