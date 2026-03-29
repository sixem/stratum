// Folder thumbnail sampling picks the first naturally sorted eligible media file per folder.
use super::super::{
    FolderThumbSampleBatchOptions, FolderThumbSampleBatchResult, FolderThumbSampleStatus,
};
use super::sort::{compare_normalized_names, normalize_name};
use std::cmp::Ordering;
use std::fs;
use std::path::Path;

fn is_supported_thumb_image(extension: &str) -> bool {
    matches!(
        extension,
        "png" | "jpg" | "jpeg" | "jfif" | "webp" | "bmp" | "gif" | "tif" | "tiff" | "ico"
    )
}

fn is_supported_thumb_svg(extension: &str) -> bool {
    matches!(extension, "svg" | "svgz")
}

fn is_supported_thumb_video(extension: &str) -> bool {
    matches!(
        extension,
        "mp4"
            | "mov"
            | "mkv"
            | "avi"
            | "webm"
            | "wmv"
            | "m4v"
            | "mpg"
            | "mpeg"
            | "flv"
            | "3gp"
            | "ogv"
    )
}

fn is_eligible_folder_thumb(path: &Path, options: &FolderThumbSampleBatchOptions) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if extension.is_empty() {
        return false;
    }
    if options.allow_svgs && is_supported_thumb_svg(&extension) {
        return true;
    }
    if is_supported_thumb_image(&extension) {
        return true;
    }
    options.allow_videos && is_supported_thumb_video(&extension)
}

fn list_folder_thumb_sample(
    folder_path: String,
    options: &FolderThumbSampleBatchOptions,
) -> FolderThumbSampleBatchResult {
    let folder_path = folder_path.trim().to_string();
    if folder_path.is_empty() {
        return FolderThumbSampleBatchResult {
            folder_path,
            sample_path: None,
            status: FolderThumbSampleStatus::Error,
        };
    }

    let entries = match fs::read_dir(&folder_path) {
        Ok(values) => values,
        Err(_) => {
            return FolderThumbSampleBatchResult {
                folder_path,
                sample_path: None,
                status: FolderThumbSampleStatus::Error,
            };
        }
    };

    // Keep only the current best sample candidate so we avoid collecting or sorting.
    let mut best_candidate: Option<(String, String)> = None;
    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            continue;
        }
        let path = entry.path();
        if !is_eligible_folder_thumb(&path, options) {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let normalized_name = normalize_name(&name);
        let sample_path = path.to_string_lossy().to_string();
        match best_candidate.as_ref() {
            Some((best_name, _))
                if compare_normalized_names(&normalized_name, best_name) != Ordering::Less => {}
            _ => best_candidate = Some((normalized_name, sample_path)),
        }
    }

    let Some((_, sample_path)) = best_candidate else {
        return FolderThumbSampleBatchResult {
            folder_path,
            sample_path: None,
            status: FolderThumbSampleStatus::Empty,
        };
    };
    FolderThumbSampleBatchResult {
        folder_path,
        sample_path: Some(sample_path),
        status: FolderThumbSampleStatus::Ok,
    }
}

pub fn list_folder_thumb_samples_batch(
    folder_paths: Vec<String>,
    options: Option<FolderThumbSampleBatchOptions>,
) -> Vec<FolderThumbSampleBatchResult> {
    let options = options.unwrap_or_default();
    folder_paths
        .into_iter()
        .map(|folder_path| list_folder_thumb_sample(folder_path, &options))
        .collect()
}
