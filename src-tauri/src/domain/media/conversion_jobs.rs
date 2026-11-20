// Backend-managed batch conversion types and execution helpers.
// This module owns per-item conversion transactions so cancel/failure cleanup
// does not leak into the modal or queue layers.
use super::{ffmpeg::FfmpegTools, images, videos};
use crate::domain::filesystem as fs;
use serde::{Deserialize, Serialize};
mod output;
use output::ConversionOutput;
use std::collections::HashMap;
use std::path::Path;

mod batch;
#[cfg(test)]
mod batch_tests;

const TRANSFER_CANCELLED_MESSAGE: &str = "Transfer cancelled";

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
    pub failed_sources: Vec<String>,
    pub warnings: Vec<String>,
}

pub(crate) type ConversionProgressCallback = dyn FnMut(fs::TransferProgressUpdate);
type BatchTools = HashMap<String, Result<FfmpegTools, String>>;

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
    batch::validate_paths(&items)?;

    let total_items = items.len();
    let mut report = ConversionReport {
        converted: 0,
        failed: 0,
        failures: Vec::new(),
        failed_sources: Vec::new(),
        warnings: Vec::new(),
    };

    // A batch may contain several configured installations. Check each once,
    // including failed checks. A subsequent job starts with fresh discovery.
    let mut tools = BatchTools::new();
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
            &mut tools,
            processed_before,
            total_items,
            &mut on_progress,
            &mut on_control,
        );

        match result {
            Ok(warning) => {
                if let Some(warning) = warning {
                    report.warnings.push(warning);
                }
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
                    report.failed_sources.push(item.source_path().to_owned());
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
    tools: &mut BatchTools,
    processed_before: usize,
    total_items: usize,
    on_progress: &mut Option<&mut ConversionProgressCallback>,
    on_control: &mut Option<&mut fs::TransferControlCallback>,
) -> Result<Option<String>, ConversionExecutionError> {
    let output = ConversionOutput::prepare(item).map_err(ConversionExecutionError::Failed)?;
    let result = run_encoder(
        item,
        tools,
        &output.payload,
        processed_before,
        total_items,
        on_progress,
        on_control,
    )
    .and_then(|()| {
        if let Some(control) = on_control.as_mut() {
            control()?;
        }
        Ok(())
    });
    if let Err(error) = result {
        return match output.discard() {
            Ok(()) if error == TRANSFER_CANCELLED_MESSAGE => {
                Err(ConversionExecutionError::Cancelled)
            }
            Ok(()) => Err(ConversionExecutionError::Failed(error)),
            Err(cleanup) => Err(ConversionExecutionError::Aborted(format!(
                "{error}. {cleanup}"
            ))),
        };
    }
    output.commit().map_err(ConversionExecutionError::Failed)
}

fn run_encoder(
    item: &ConversionJobItem,
    tools: &mut BatchTools,
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
            let configured = options.ffmpeg_path.as_deref().unwrap_or_default().trim();
            let installation = tools
                .entry(configured.to_owned())
                .or_insert_with(|| FfmpegTools::resolve(Some(configured)))
                .as_ref()
                .map_err(String::clone)?;
            videos::convert_video(
                source_path,
                temp_output_path.to_string_lossy().to_string(),
                options,
                installation,
                Some(&mut video_progress),
                control_callback,
            )
        }
    }
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
