// Thumbnail generation pipeline: queueing, worker threads, and cache management.
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime};

#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::iter::once;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;

#[cfg(target_os = "windows")]
use windows::core::PCWSTR;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::SIZE;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, SelectObject, BITMAP,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_THUMBNAILONLY,
};

use image::io::Reader as ImageReader;
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{self, TreeParsing};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbOptions {
    pub size: u32,
    pub quality: u8,
    pub format: ThumbFormat,
    pub allow_videos: bool,
    pub allow_svgs: bool,
    pub cache_mb: u32,
}

// Optional size/modified fields let the UI skip filesystem metadata calls.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbRequest {
    pub path: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    // Optional UI-provided signature so async events can confirm freshness.
    pub signature: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThumbFormat {
    Webp,
    Jpeg,
}

#[derive(Clone, Copy)]
enum ThumbKind {
    Image,
    Video,
    Svg,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbHit {
    pub path: String,
    pub thumb_path: String,
    pub key: String,
    pub signature: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbReady {
    pub path: String,
    pub thumb_path: String,
    pub key: String,
    pub signature: String,
}

struct ThumbJob {
    id: String,
    path: PathBuf,
    thumb_path: PathBuf,
    key: String,
    signature: String,
    options: ThumbOptions,
    kind: ThumbKind,
}

struct ThumbMeta {
    size: u64,
    modified: Option<u64>,
}

struct ThumbQueue {
    items: VecDeque<ThumbJob>,
    in_flight: HashSet<String>,
    paused: bool,
}

pub struct ThumbnailState {
    app_handle: AppHandle,
    cache_dir: PathBuf,
    queue: Mutex<ThumbQueue>,
    condvar: Condvar,
    trim_state: Mutex<CacheTrimState>,
}

pub type ThumbnailHandle = Arc<ThumbnailState>;

const MAX_THUMB_WORKERS: usize = 3;
const MAX_THUMB_SIZE: u32 = 320;
const TRIM_SCAN_INTERVAL_SECS: u64 = 30;
const TRIM_SCAN_THRESHOLD_PERCENT: u64 = 85;
const TRIM_UNKNOWN_SCAN_GROWTH_BYTES: u64 = 32 * 1024 * 1024;

struct CacheTrimState {
    last_trim: Option<SystemTime>,
    approx_total_bytes: Option<u64>,
    pending_growth_bytes: u64,
}

struct ThumbRenderOutput {
    path: PathBuf,
    added_bytes: u64,
}

pub fn init(app_handle: AppHandle) -> ThumbnailHandle {
    let cache_dir = resolve_cache_dir(&app_handle);
    if let Err(err) = fs::create_dir_all(&cache_dir) {
        eprintln!("thumb cache init failed: {err}");
    }
    let state = Arc::new(ThumbnailState {
        app_handle,
        cache_dir,
        queue: Mutex::new(ThumbQueue {
            items: VecDeque::new(),
            in_flight: HashSet::new(),
            paused: false,
        }),
        condvar: Condvar::new(),
        trim_state: Mutex::new(CacheTrimState {
            last_trim: None,
            approx_total_bytes: None,
            pending_growth_bytes: 0,
        }),
    });

    // Leave room for UI threads by keeping the worker pool intentionally small.
    let worker_count = std::thread::available_parallelism()
        .map(|value| value.get().saturating_sub(1).max(1))
        .unwrap_or(2)
        .min(MAX_THUMB_WORKERS);
    for index in 0..worker_count {
        let state_clone = Arc::clone(&state);
        let _ = std::thread::Builder::new()
            .name(format!("thumb-worker-{index}"))
            .spawn(move || worker_loop(state_clone));
    }

    state
}

pub fn request_thumbnails(
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
        if thumb_path.exists() {
            hits.push(ThumbHit {
                path: trimmed.to_string(),
                thumb_path: thumb_path.to_string_lossy().to_string(),
                key: key.clone(),
                signature: signature.clone(),
            });
            continue;
        }

        let mut queue = state.queue.lock().expect("thumb queue lock");
        if queue.in_flight.contains(&thumb_id) {
            continue;
        }
        queue.in_flight.insert(thumb_id.clone());
        // Prioritize the latest requests so current thumbnails appear sooner.
        queue.items.push_front(ThumbJob {
            id: thumb_id,
            path: input_path,
            thumb_path,
            key: key.clone(),
            signature,
            options: options.clone(),
            kind,
        });
        state.condvar.notify_one();
    }

    hits
}

pub fn set_paused(state: &ThumbnailState, paused: bool) {
    let mut queue = state.queue.lock().expect("thumb queue lock");
    if queue.paused == paused {
        return;
    }
    queue.paused = paused;
    if !paused {
        state.condvar.notify_all();
    }
}

fn worker_loop(state: ThumbnailHandle) {
    #[cfg(target_os = "windows")]
    // Initialize COM once per worker thread so video thumbnail jobs avoid per-item setup.
    let _com_guard = match ComGuard::new() {
        Ok(guard) => Some(guard),
        Err(error) => {
            eprintln!("thumb worker COM init failed: {error}");
            None
        }
    };

    loop {
        let job = {
            let mut queue = state.queue.lock().expect("thumb queue lock");
            while queue.items.is_empty() || queue.paused {
                queue = state.condvar.wait(queue).expect("thumb queue wait");
            }
            queue.items.pop_front()
        };

        let Some(job) = job else { continue };
        let result = render_thumbnail(&job);

        {
            let mut queue = state.queue.lock().expect("thumb queue lock");
            queue.in_flight.remove(&job.id);
        }

        if let Ok(output) = result {
            maybe_trim_cache(
                &state.cache_dir,
                job.options.cache_mb,
                &state.trim_state,
                output.added_bytes,
            );
            let payload = ThumbReady {
                path: job.path.to_string_lossy().to_string(),
                thumb_path: output.path.to_string_lossy().to_string(),
                key: job.key,
                signature: job.signature,
            };
            let _ = state.app_handle.emit("thumb_ready", payload);
        }
    }
}

fn render_thumbnail(job: &ThumbJob) -> Result<ThumbRenderOutput, String> {
    if job.thumb_path.exists() {
        return Ok(ThumbRenderOutput {
            path: job.thumb_path.clone(),
            added_bytes: 0,
        });
    }
    let parent = job
        .thumb_path
        .parent()
        .ok_or_else(|| "invalid thumbnail path".to_string())?;
    fs::create_dir_all(parent).map_err(|err| err.to_string())?;

    let target_size = clamp_thumb_size(job.options.size);
    let image = load_source_image(job, target_size)?;
    let resized = image.thumbnail(target_size, target_size);
    let mut file = fs::File::create(&job.thumb_path).map_err(|err| err.to_string())?;
    match job.options.format {
        ThumbFormat::Webp => resized
            .write_to(&mut file, image::ImageOutputFormat::WebP)
            .map_err(|err| err.to_string())?,
        ThumbFormat::Jpeg => resized
            .write_to(
                &mut file,
                image::ImageOutputFormat::Jpeg(job.options.quality),
            )
            .map_err(|err| err.to_string())?,
    }
    let added_bytes = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    Ok(ThumbRenderOutput {
        path: job.thumb_path.clone(),
        added_bytes,
    })
}

fn clamp_thumb_size(size: u32) -> u32 {
    size.max(1).min(MAX_THUMB_SIZE)
}

fn load_source_image(job: &ThumbJob, target_size: u32) -> Result<image::DynamicImage, String> {
    match job.kind {
        // Decode by inspecting file bytes so JPEG variants like `.jfif` work even when
        // the extension is not part of the image crate's default extension table.
        ThumbKind::Image => ImageReader::open(&job.path)
            .map_err(|err| err.to_string())?
            .with_guessed_format()
            .map_err(|err| err.to_string())?
            .decode()
            .map_err(|err| err.to_string()),
        ThumbKind::Video => render_video_thumbnail(&job.path, target_size),
        ThumbKind::Svg => render_svg_thumbnail(&job.path, target_size),
    }
}

#[cfg(target_os = "windows")]
// Use the shell thumbnail provider to keep video previews lightweight.
fn render_video_thumbnail(path: &Path, size: u32) -> Result<image::DynamicImage, String> {
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).collect();
    let factory: IShellItemImageFactory =
        unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None) }
            .map_err(|err| err.to_string())?;
    let hbitmap = unsafe {
        factory
            .GetImage(
                SIZE {
                    cx: size as i32,
                    cy: size as i32,
                },
                SIIGBF_BIGGERSIZEOK | SIIGBF_THUMBNAILONLY,
            )
            .map_err(|err| err.to_string())?
    };
    let image = hbitmap_to_image(hbitmap);
    unsafe {
        let _ = DeleteObject(HGDIOBJ(hbitmap.0));
    }
    image
}

#[cfg(not(target_os = "windows"))]
fn render_video_thumbnail(_path: &Path, _size: u32) -> Result<image::DynamicImage, String> {
    Err("Video thumbnails are not supported on this platform".to_string())
}

// Rasterize SVGs into bitmap previews so they are safe to display.
fn render_svg_thumbnail(path: &Path, target_size: u32) -> Result<image::DynamicImage, String> {
    let data = read_svg_data(path)?;
    let mut options = usvg::Options::default();
    options.resources_dir = path.parent().map(|parent| parent.to_path_buf());
    let mut tree = usvg::Tree::from_data(&data, &options).map_err(|err| err.to_string())?;
    // Resolve transforms and bounds so resvg renders the SVG correctly.
    tree.calculate_abs_transforms();
    tree.calculate_bounding_boxes();
    let size = tree.size.to_int_size();
    let (width, height) = fit_svg_size(size.width(), size.height(), target_size);
    let mut pixmap =
        Pixmap::new(width, height).ok_or_else(|| "Invalid SVG render size".to_string())?;
    // resvg renders at the tree's intrinsic size, so we scale to the thumbnail size.
    let transform = Transform::from_scale(
        width as f32 / size.width() as f32,
        height as f32 / size.height() as f32,
    );
    let mut pixmap_mut = pixmap.as_mut();
    resvg::render(&tree, transform, &mut pixmap_mut);
    let image = image::RgbaImage::from_raw(width, height, pixmap.take())
        .ok_or_else(|| "Invalid SVG render buffer".to_string())?;
    Ok(image::DynamicImage::ImageRgba8(image))
}

// Handle both plain SVG and gzipped SVGZ sources.
fn read_svg_data(path: &Path) -> Result<Vec<u8>, String> {
    let raw = fs::read(path).map_err(|err| err.to_string())?;
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "svgz" {
        return Ok(raw);
    }
    let mut decoder = flate2::read::GzDecoder::new(raw.as_slice());
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|err| err.to_string())?;
    Ok(decompressed)
}

fn fit_svg_size(width: u32, height: u32, max_size: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (max_size.max(1), max_size.max(1));
    }
    let max_edge = width.max(height) as f32;
    let scale = (max_size.max(1) as f32) / max_edge;
    let target_width = (width as f32 * scale).round().max(1.0) as u32;
    let target_height = (height as f32 * scale).round().max(1.0) as u32;
    (target_width, target_height)
}

#[cfg(target_os = "windows")]
struct ComGuard;

#[cfg(target_os = "windows")]
impl ComGuard {
    fn new() -> Result<Self, String> {
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        hr.ok().map_err(|err| err.to_string())?;
        Ok(Self)
    }
}

#[cfg(target_os = "windows")]
impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

#[cfg(target_os = "windows")]
fn hbitmap_to_image(bitmap: HBITMAP) -> Result<image::DynamicImage, String> {
    let mut bmp = BITMAP::default();
    let bmp_size = std::mem::size_of::<BITMAP>() as i32;
    let read = unsafe { GetObjectW(HGDIOBJ(bitmap.0), bmp_size, Some(&mut bmp as *mut _ as _)) };
    if read == 0 {
        return Err("Failed to read thumbnail bitmap".to_string());
    }

    let width = bmp.bmWidth;
    let height = bmp.bmHeight.abs();
    if width <= 0 || height <= 0 {
        return Err("Invalid thumbnail bitmap size".to_string());
    }

    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width,
        biHeight: -height,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };

    let mut buffer = vec![0u8; width as usize * height as usize * 4];
    let hdc = unsafe { CreateCompatibleDC(None) };
    if hdc.is_invalid() {
        return Err("Failed to create thumbnail context".to_string());
    }
    let old = unsafe { SelectObject(hdc, HGDIOBJ(bitmap.0)) };
    let scan_lines = unsafe {
        GetDIBits(
            hdc,
            bitmap,
            0,
            height as u32,
            Some(buffer.as_mut_ptr() as *mut _),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    unsafe {
        SelectObject(hdc, old);
        let _ = DeleteDC(hdc);
    }
    if scan_lines == 0 {
        return Err("Failed to read thumbnail pixels".to_string());
    }

    for chunk in buffer.chunks_exact_mut(4) {
        let blue = chunk[0];
        chunk[0] = chunk[2];
        chunk[2] = blue;
    }

    let image = image::RgbaImage::from_raw(width as u32, height as u32, buffer)
        .ok_or_else(|| "Invalid thumbnail buffer".to_string())?;
    Ok(image::DynamicImage::ImageRgba8(image))
}

struct CacheEntry {
    path: PathBuf,
    modified: SystemTime,
    size: u64,
}

fn maybe_trim_cache(
    cache_dir: &Path,
    limit_mb: u32,
    trim_state: &Mutex<CacheTrimState>,
    added_bytes: u64,
) {
    if limit_mb == 0 {
        return;
    }
    let limit_bytes = limit_mb as u64 * 1024 * 1024;
    if limit_bytes == 0 {
        return;
    }

    let now = SystemTime::now();
    let mut should_scan = false;
    let mut force_scan = false;
    let pending_for_scan: u64;
    {
        let mut state = trim_state.lock().expect("thumb trim lock");

        if added_bytes > 0 {
            state.pending_growth_bytes = state.pending_growth_bytes.saturating_add(added_bytes);
        }

        let pending_growth = state.pending_growth_bytes;
        if pending_growth == 0 {
            return;
        }
        pending_for_scan = pending_growth;

        match state.approx_total_bytes {
            Some(approx_total) => {
                let projected_total = approx_total.saturating_add(pending_growth);
                let threshold = limit_bytes.saturating_mul(TRIM_SCAN_THRESHOLD_PERCENT) / 100;
                if projected_total >= threshold {
                    should_scan = true;
                    force_scan = projected_total >= limit_bytes;
                }
            }
            None => {
                let unknown_threshold = TRIM_UNKNOWN_SCAN_GROWTH_BYTES.min(limit_bytes);
                if pending_growth >= unknown_threshold {
                    should_scan = true;
                }
            }
        }

        if !should_scan {
            return;
        }

        if !force_scan {
            if let Some(previous) = state.last_trim {
                if now.duration_since(previous).unwrap_or_default()
                    < Duration::from_secs(TRIM_SCAN_INTERVAL_SECS)
                {
                    return;
                }
            }
        }

        state.last_trim = Some(now);
    }

    let (mut entries, mut total) = collect_cache_entries(cache_dir);
    if total <= limit_bytes {
        let mut state = trim_state.lock().expect("thumb trim lock");
        state.approx_total_bytes = Some(total);
        state.pending_growth_bytes = state.pending_growth_bytes.saturating_sub(pending_for_scan);
        return;
    }

    entries.sort_by_key(|entry| entry.modified);
    for entry in entries {
        if total <= limit_bytes {
            break;
        }
        if fs::remove_file(&entry.path).is_ok() {
            total = total.saturating_sub(entry.size);
        }
    }

    let mut state = trim_state.lock().expect("thumb trim lock");
    state.approx_total_bytes = Some(total);
    state.pending_growth_bytes = state.pending_growth_bytes.saturating_sub(pending_for_scan);
}

fn collect_cache_entries(cache_dir: &Path) -> (Vec<CacheEntry>, u64) {
    let mut entries = Vec::new();
    let mut total: u64 = 0;
    let mut stack = vec![cache_dir.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let read_dir = match fs::read_dir(&dir) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for item in read_dir {
            let entry = match item {
                Ok(value) => value,
                Err(_) => continue,
            };
            let path = entry.path();
            let metadata = match entry.metadata() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                stack.push(path);
                continue;
            }
            let size = metadata.len();
            total = total.saturating_add(size);
            let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            entries.push(CacheEntry {
                path,
                modified,
                size,
            });
        }
    }

    (entries, total)
}

fn resolve_cache_dir(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("thumbs")
}

pub fn get_cache_dir(app_handle: &AppHandle) -> PathBuf {
    resolve_cache_dir(app_handle)
}

pub fn clear_cache_dir(app_handle: &AppHandle) -> Result<(), String> {
    let cache_dir = resolve_cache_dir(app_handle);
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&cache_dir).map_err(|err| err.to_string())?;
    Ok(())
}

pub fn get_cache_size(app_handle: &AppHandle) -> Result<u64, String> {
    let cache_dir = resolve_cache_dir(app_handle);
    if !cache_dir.exists() {
        return Ok(0);
    }
    let (_, total) = collect_cache_entries(&cache_dir);
    Ok(total)
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
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
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
