// Request preparation for thumbnail batches: select supported files, resolve
// metadata, and either return cache hits or enqueue render jobs.
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::cache;
use super::{ThumbJob, ThumbKind, ThumbMeta, ThumbQueue, ThumbnailState};
use super::{ThumbFormat, ThumbHit, ThumbOptions, ThumbRequest};

pub(super) fn request_thumbnails(
    state: &ThumbnailState,
    requests: Vec<ThumbRequest>,
    options: ThumbOptions,
    key: String,
) -> Vec<ThumbHit> {
    let mut hits = Vec::with_capacity(requests.len());

    for request in requests.into_iter().rev() {
        let trimmed = request.path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let input_path = PathBuf::from(trimmed);
        let Some(kind) = select_thumbnail_kind(&input_path, &options) else {
            continue;
        };
        let Some(meta) = resolve_thumb_meta(&input_path, &request) else {
            continue;
        };
        let signature = resolve_request_signature(trimmed, &request, &key);

        let (thumb_path, thumb_id) =
            build_thumb_path(&state.cache_dir, &input_path, &meta, &key, &options.format);
        if cache::has_cache_entry(state, &thumb_id) {
            hits.push(ThumbHit {
                path: trimmed.to_string(),
                thumb_path: thumb_path.to_string_lossy().to_string(),
                key: key.clone(),
                signature,
            });
            continue;
        }

        enqueue_thumbnail_job(
            state,
            ThumbJob {
                id: thumb_id,
                path: input_path,
                thumb_path,
                key: key.clone(),
                signature,
                options: options.clone(),
                kind,
            },
        );
    }

    hits
}

fn enqueue_thumbnail_job(state: &ThumbnailState, job: ThumbJob) {
    let mut queue = state.queue.lock().expect("thumb queue lock");
    if queue.in_flight.contains(&job.id) {
        return;
    }
    queue.in_flight.insert(job.id.clone());
    push_latest_request(&mut queue, job);
    state.condvar.notify_one();
}

fn push_latest_request(queue: &mut ThumbQueue, job: ThumbJob) {
    // Prioritize the latest requests so current thumbnails appear sooner.
    queue.items.push_front(job);
}

fn resolve_thumb_meta(input_path: &Path, request: &ThumbRequest) -> Option<ThumbMeta> {
    // Use UI-provided metadata when available to avoid extra stat calls.
    if let (Some(size), Some(modified)) = (request.size, request.modified) {
        return Some(ThumbMeta {
            size,
            modified: Some(modified),
        });
    }
    let metadata = fs::metadata(input_path).ok()?;
    if metadata.is_dir() {
        return None;
    }
    Some(ThumbMeta {
        size: metadata.len(),
        modified: metadata.modified().ok().and_then(to_epoch_ms),
    })
}

fn resolve_request_signature(path: &str, request: &ThumbRequest, key: &str) -> String {
    if let Some(signature) = &request.signature {
        return signature.clone();
    }
    let size = request
        .size
        .map(|value| value.to_string())
        .unwrap_or_else(|| "none".to_string());
    let modified = request
        .modified
        .map(|value| value.to_string())
        .unwrap_or_else(|| "none".to_string());
    format!("{key}:{path}:{size}:{modified}")
}

fn build_thumb_path(
    cache_dir: &Path,
    input_path: &Path,
    meta: &ThumbMeta,
    key: &str,
    format: &ThumbFormat,
) -> (PathBuf, String) {
    let mut hasher = DefaultHasher::new();
    input_path.hash(&mut hasher);
    meta.size.hash(&mut hasher);
    if let Some(modified) = meta.modified {
        modified.hash(&mut hasher);
    }
    key.hash(&mut hasher);
    let hash = hasher.finish();
    let shard = format!("{:02x}", hash & 0xff);
    let extension = match format {
        ThumbFormat::Webp => "webp",
        ThumbFormat::Jpeg => "jpg",
    };
    let file_name = format!("{:x}.{}", hash, extension);
    (cache_dir.join(shard).join(&file_name), file_name)
}

fn to_epoch_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

fn select_thumbnail_kind(path: &Path, options: &ThumbOptions) -> Option<ThumbKind> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let lower = ext.to_lowercase();
    if options.allow_svgs && is_supported_svg(&lower) {
        return Some(ThumbKind::Svg);
    }
    if is_supported_image(&lower) {
        return Some(ThumbKind::Image);
    }
    if options.allow_videos && is_supported_video(&lower) {
        #[cfg(target_os = "windows")]
        {
            return Some(ThumbKind::Video);
        }
        #[cfg(not(target_os = "windows"))]
        {
            return None;
        }
    }
    None
}

fn is_supported_image(extension: &str) -> bool {
    matches!(
        extension,
        "png" | "jpg" | "jpeg" | "jfif" | "webp" | "bmp" | "gif" | "tif" | "tiff" | "ico"
    )
}

fn is_supported_svg(extension: &str) -> bool {
    matches!(extension, "svg" | "svgz")
}

fn is_supported_video(extension: &str) -> bool {
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
