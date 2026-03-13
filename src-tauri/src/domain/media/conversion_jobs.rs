// Backend-managed batch conversion types and execution helpers.
// This module owns per-item conversion transactions so cancel/failure cleanup
// does not leak into the modal or queue layers.
use super::{images, videos};
use crate::domain::filesystem as fs;
use serde::{Deserialize, Serialize};
use std::fs as std_fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

const TRANSFER_CANCELLED_MESSAGE: &str = "Transfer cancelled";
const FILE_OPERATION_RETRY_ATTEMPTS: usize = 8;
const FILE_OPERATION_RETRY_DELAY_MS: u64 = 60;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ConversionJobItem {
    Image {
        #[serde(rename = "sourcePath")]
        source_path: String,
        #[serde(rename = "destinationPath")]
        destination_path: String,
        #[serde(rename = "deleteSourceAfterSuccess")]
        delete_source_after_success: bool,
        options: images::ImageConvertOptions,
    },
    Video {
        #[serde(rename = "sourcePath")]
        source_path: String,
        #[serde(rename = "destinationPath")]
        destination_path: String,
        #[serde(rename = "deleteSourceAfterSuccess")]
        delete_source_after_success: bool,
        options: videos::VideoConvertOptions,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionReport {
    pub converted: usize,
    pub failed: usize,
    pub failures: Vec<String>,
}

pub(crate) type ConversionProgressCallback = dyn FnMut(fs::TransferProgressUpdate);

struct PreparedConversionExecution {
    source_path: String,
    destination_path: String,
    temp_output_path: PathBuf,
    delete_source_after_success: bool,
    overwrite: bool,
}

struct CommitState {
    destination_path: PathBuf,
    source_path: PathBuf,
    destination_backup_path: Option<PathBuf>,
    source_backup_path: Option<PathBuf>,
}

enum ConversionExecutionError {
    Cancelled,
    Aborted(String),
    Failed(String),
}

impl ConversionJobItem {
    pub fn source_path(&self) -> &str {
        match self {
            Self::Image { source_path, .. } | Self::Video { source_path, .. } => source_path,
        }
    }

    fn destination_path(&self) -> &str {
        match self {
            Self::Image {
                destination_path, ..
            }
            | Self::Video {
                destination_path, ..
            } => destination_path,
        }
    }

    fn delete_source_after_success(&self) -> bool {
        match self {
            Self::Image {
                delete_source_after_success,
                ..
            }
            | Self::Video {
                delete_source_after_success,
                ..
            } => *delete_source_after_success,
        }
    }

    fn overwrite(&self) -> bool {
        match self {
            Self::Image { options, .. } => options.overwrite.unwrap_or(false),
            Self::Video { options, .. } => options.overwrite.unwrap_or(false),
        }
    }
}

pub fn convert_items(
    items: Vec<ConversionJobItem>,
    mut on_progress: Option<&mut ConversionProgressCallback>,
    mut on_control: Option<&mut fs::TransferControlCallback>,
) -> Result<ConversionReport, String> {
    if items.is_empty() {
        return Err("No conversion items were provided.".to_string());
    }

    let total_items = items.len();
    let mut report = ConversionReport {
        converted: 0,
        failed: 0,
        failures: Vec::new(),
    };

    for item in items {
        if let Some(control) = on_control.as_mut() {
            control()?;
        }

        let processed_before = report.converted + report.failed;
        emit_progress(
            &mut on_progress,
            fs::TransferProgressUpdate {
                processed: processed_before,
                total: total_items,
                current_path: Some(item.source_path().to_string()),
                current_bytes: None,
                current_total_bytes: None,
                progress_percent: batch_progress_percent(processed_before, total_items),
                status_text: Some(format!("Starting {}", item_label(item.source_path()))),
                rate_text: None,
            },
        );

        let result = convert_single_item(
            &item,
            processed_before,
            total_items,
            &mut on_progress,
            &mut on_control,
        );

        match result {
            Ok(()) => {
                report.converted += 1;
                let processed = report.converted + report.failed;
                emit_progress(
                    &mut on_progress,
                    fs::TransferProgressUpdate {
                        processed,
                        total: total_items,
                        current_path: Some(item.destination_path().to_string()),
                        current_bytes: None,
                        current_total_bytes: None,
                        progress_percent: batch_progress_percent(processed, total_items),
                        status_text: None,
                        rate_text: None,
                    },
                );
            }
            Err(error) => match error {
                ConversionExecutionError::Cancelled => {
                    return Err(TRANSFER_CANCELLED_MESSAGE.to_string());
                }
                ConversionExecutionError::Aborted(error) => {
                    return Err(error);
                }
                ConversionExecutionError::Failed(error) => {
                    report.failed += 1;
                    report
                        .failures
                        .push(format!("{}: {error}", item.source_path().trim()));
                    let processed = report.converted + report.failed;
                    emit_progress(
                        &mut on_progress,
                        fs::TransferProgressUpdate {
                            processed,
                            total: total_items,
                            current_path: Some(item.source_path().to_string()),
                            current_bytes: None,
                            current_total_bytes: None,
                            progress_percent: batch_progress_percent(processed, total_items),
                            status_text: Some("Failed".to_string()),
                            rate_text: None,
                        },
                    );
                }
            },
        }
    }

    Ok(report)
}

fn convert_single_item(
    item: &ConversionJobItem,
    processed_before: usize,
    total_items: usize,
    on_progress: &mut Option<&mut ConversionProgressCallback>,
    on_control: &mut Option<&mut fs::TransferControlCallback>,
) -> Result<(), ConversionExecutionError> {
    let prepared = prepare_execution(item).map_err(ConversionExecutionError::Failed)?;
    let conversion_result = run_encoder(
        item,
        &prepared.temp_output_path,
        processed_before,
        total_items,
        on_progress,
        on_control,
    );

    if let Err(error) = conversion_result {
        return Err(finalize_failed_execution(error, &prepared.temp_output_path));
    }

    if let Some(control) = on_control.as_mut() {
        if let Err(error) = control() {
            return Err(finalize_failed_execution(error, &prepared.temp_output_path));
        }
    }

    commit_prepared_output(&prepared).map_err(ConversionExecutionError::Failed)
}

fn prepare_execution(item: &ConversionJobItem) -> Result<PreparedConversionExecution, String> {
    let destination_path = PathBuf::from(item.destination_path().trim());
    if destination_path.exists() && destination_path.is_dir() {
        return Err("Destination is a folder".to_string());
    }
    let temp_output_path = reserve_sibling_path(&destination_path, "temp")?;
    Ok(PreparedConversionExecution {
        source_path: item.source_path().trim().to_string(),
        destination_path: item.destination_path().trim().to_string(),
        temp_output_path,
        delete_source_after_success: item.delete_source_after_success(),
        overwrite: item.overwrite(),
    })
}

fn run_encoder(
    item: &ConversionJobItem,
    temp_output_path: &Path,
    processed_before: usize,
    total_items: usize,
    on_progress: &mut Option<&mut ConversionProgressCallback>,
    on_control: &mut Option<&mut fs::TransferControlCallback>,
) -> Result<(), String> {
    match item.clone() {
        ConversionJobItem::Image {
            source_path,
            mut options,
            ..
        } => {
            options.overwrite = Some(false);
            images::convert_image(
                source_path,
                temp_output_path.to_string_lossy().to_string(),
                options,
            )
        }
        ConversionJobItem::Video {
            source_path,
            mut options,
            ..
        } => {
            options.overwrite = Some(false);
            options.progress = Some(videos::VideoConvertProgressOptions {
                completed_items: processed_before,
                total_items,
            });
            let mut video_progress = |update: videos::VideoProgressUpdate| {
                emit_progress(
                    on_progress,
                    fs::TransferProgressUpdate {
                        processed: update.processed,
                        total: update.total,
                        current_path: update.current_path,
                        current_bytes: None,
                        current_total_bytes: None,
                        progress_percent: update.progress_percent,
                        status_text: update.status_text,
                        rate_text: update.rate_text,
                    },
                );
            };
            let control_callback = on_control.as_mut().map(|callback| &mut **callback);
            videos::convert_video(
                source_path,
                temp_output_path.to_string_lossy().to_string(),
                options,
                Some(&mut video_progress),
                control_callback,
            )
        }
    }
}

fn commit_prepared_output(prepared: &PreparedConversionExecution) -> Result<(), String> {
    let source_path = PathBuf::from(prepared.source_path.trim());
    let destination_path = PathBuf::from(prepared.destination_path.trim());

    let mut commit_state = CommitState {
        destination_path: destination_path.clone(),
        source_path: source_path.clone(),
        destination_backup_path: None,
        source_backup_path: None,
    };

    if destination_path.exists() {
        if destination_path.is_dir() {
            return fail_with_temp_cleanup(
                "Destination is a folder".to_string(),
                &prepared.temp_output_path,
            );
        }
        if !prepared.overwrite {
            return fail_with_temp_cleanup(
                "Destination already exists".to_string(),
                &prepared.temp_output_path,
            );
        }
        let backup_path = reserve_sibling_path(&destination_path, "dest-backup")
            .map_err(|error| fail_with_temp_cleanup(error, &prepared.temp_output_path).unwrap_err())?;
        if let Err(error) = rename_path(&destination_path, &backup_path) {
            return fail_with_temp_cleanup(
                format!("Failed to stage the destination for replacement: {error}"),
                &prepared.temp_output_path,
            );
        }
        commit_state.destination_backup_path = Some(backup_path);
    }

    if let Err(error) = std_fs::rename(&prepared.temp_output_path, &destination_path) {
        return Err(format_cleanup_failure(
            format!("Failed to commit converted output: {error}"),
            rollback_commit(&mut commit_state).err(),
            cleanup_temp_output(&prepared.temp_output_path).err(),
        ));
    }

    if prepared.delete_source_after_success {
        let backup_path = reserve_sibling_path(&source_path, "source-backup")?;
        if let Err(error) = rename_path(&source_path, &backup_path) {
            return Err(format_cleanup_failure(
                format!("Failed to stage the original source for removal: {error}"),
                rollback_commit(&mut commit_state).err(),
                None,
            ));
        }
        commit_state.source_backup_path = Some(backup_path);
    }

    if let Some(backup_path) = commit_state.destination_backup_path.take() {
        if let Err(error) = remove_path(&backup_path) {
            commit_state.destination_backup_path = Some(backup_path);
            return Err(format_cleanup_failure(
                format!("Failed to clean up the replaced destination: {error}"),
                rollback_commit(&mut commit_state).err(),
                None,
            ));
        }
    }

    if let Some(backup_path) = commit_state.source_backup_path.take() {
        if let Err(error) = remove_path(&backup_path) {
            commit_state.source_backup_path = Some(backup_path);
            return Err(format_cleanup_failure(
                format!("Failed to remove the original source after conversion: {error}"),
                rollback_commit(&mut commit_state).err(),
                None,
            ));
        }
    }

    Ok(())
}

fn rollback_commit(state: &mut CommitState) -> Result<(), String> {
    let mut failures = Vec::new();

    if state.destination_path.exists() {
        if let Err(error) = remove_path(&state.destination_path) {
            failures.push(format!("Failed to remove the staged converted output: {error}"));
        }
    }

    if let Some(source_backup_path) = state.source_backup_path.as_ref() {
        if source_backup_path.exists() {
            if let Err(error) = rename_path(source_backup_path, &state.source_path) {
                failures.push(format!("Failed to restore the original source: {error}"));
            }
        }
    }

    if let Some(destination_backup_path) = state.destination_backup_path.as_ref() {
        if destination_backup_path.exists() {
            if let Err(error) = rename_path(destination_backup_path, &state.destination_path) {
                failures.push(format!("Failed to restore the original destination: {error}"));
            }
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join(" "))
    }
}

fn cleanup_temp_output(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    remove_path(path)
}

fn remove_path(path: &Path) -> Result<(), String> {
    retry_file_operation(|| match std_fs::metadata(path) {
        Ok(metadata) => {
            if metadata.is_dir() {
                std_fs::remove_dir_all(path)
            } else {
                std_fs::remove_file(path)
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    })
    .map_err(|error| error.to_string())
}

fn rename_path(from: &Path, to: &Path) -> Result<(), String> {
    retry_file_operation(|| std_fs::rename(from, to)).map_err(|error| error.to_string())
}

fn reserve_sibling_path(base_path: &Path, tag: &str) -> Result<PathBuf, String> {
    let parent = base_path
        .parent()
        .ok_or_else(|| "Unable to resolve the destination folder".to_string())?;
    if !parent.exists() {
        std_fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let file_stem = base_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("converted");
    let extension = base_path.extension().and_then(|value| value.to_str());
    let process_id = std::process::id();

    for attempt in 0..512 {
        let suffix = if attempt == 0 {
            format!(".stratum-{tag}-{process_id}")
        } else {
            format!(".stratum-{tag}-{process_id}-{attempt}")
        };
        let candidate_name = match extension {
            Some(extension) if !extension.is_empty() => format!("{file_stem}{suffix}.{extension}"),
            _ => format!("{file_stem}{suffix}"),
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("Unable to reserve a temporary conversion path.".to_string())
}

fn emit_progress(
    callback: &mut Option<&mut ConversionProgressCallback>,
    update: fs::TransferProgressUpdate,
) {
    let Some(handler) = callback.as_mut() else {
        return;
    };
    handler(update);
}

fn batch_progress_percent(processed: usize, total: usize) -> Option<f64> {
    if total == 0 {
        return None;
    }
    Some(((processed as f64) / (total as f64) * 100.0).clamp(0.0, 100.0))
}

fn item_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn finalize_failed_execution(error: String, temp_output_path: &Path) -> ConversionExecutionError {
    let cleanup_error = cleanup_temp_output(temp_output_path).err();
    if error.trim() == TRANSFER_CANCELLED_MESSAGE {
        return match cleanup_error {
            Some(cleanup_error) => ConversionExecutionError::Aborted(format!(
                "Cancellation cleanup failed: {cleanup_error}"
            )),
            None => ConversionExecutionError::Cancelled,
        };
    }

    match cleanup_error {
        Some(cleanup_error) => ConversionExecutionError::Failed(format!(
            "{error} Temporary cleanup also failed: {cleanup_error}"
        )),
        None => ConversionExecutionError::Failed(error),
    }
}

fn fail_with_temp_cleanup(error: String, temp_output_path: &Path) -> Result<(), String> {
    match cleanup_temp_output(temp_output_path) {
        Ok(()) => Err(error),
        Err(cleanup_error) => Err(format_cleanup_failure(error, None, Some(cleanup_error))),
    }
}

fn format_cleanup_failure(
    base_error: String,
    rollback_error: Option<String>,
    cleanup_error: Option<String>,
) -> String {
    let mut follow_up = Vec::new();
    if let Some(rollback_error) = rollback_error {
        follow_up.push(format!("Rollback also failed: {rollback_error}"));
    }
    if let Some(cleanup_error) = cleanup_error {
        follow_up.push(format!("Cleanup also failed: {cleanup_error}"));
    }
    if follow_up.is_empty() {
        base_error
    } else {
        format!("{base_error} {}", follow_up.join(" "))
    }
}

// Freshly written files can stay briefly locked on Windows while the encoder,
// AV, or indexer releases handles. Retry cleanup/rollback work a few times so
// transient locks do not leave conversion residue behind.
fn retry_file_operation<T, F>(mut operation: F) -> Result<T, std::io::Error>
where
    F: FnMut() -> std::io::Result<T>,
{
    for attempt in 0..FILE_OPERATION_RETRY_ATTEMPTS {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) => {
                if attempt + 1 == FILE_OPERATION_RETRY_ATTEMPTS {
                    return Err(error);
                }
                thread::sleep(Duration::from_millis(FILE_OPERATION_RETRY_DELAY_MS));
            }
        }
    }

    unreachable!("file operation retry loop must return before exhaustion")
}
