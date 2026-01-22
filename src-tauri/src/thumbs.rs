use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::hash::{Hash, Hasher};
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
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
    SIIGBF_THUMBNAILONLY,
};

use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbOptions {
    pub size: u32,
    pub quality: u8,
    pub format: ThumbFormat,
    pub allow_videos: bool,
    pub cache_mb: u32,
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
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbHit {
    pub path: String,
    pub thumb_path: String,
    pub key: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbReady {
    pub path: String,
    pub thumb_path: String,
    pub key: String,
}

struct ThumbJob {
    id: String,
    path: PathBuf,
    thumb_path: PathBuf,
    key: String,
    options: ThumbOptions,
    kind: ThumbKind,
}

struct ThumbQueue {
    items: VecDeque<ThumbJob>,
    in_flight: HashSet<String>,
}

pub struct ThumbnailState {
    app_handle: AppHandle,
    cache_dir: PathBuf,
    queue: Mutex<ThumbQueue>,
    condvar: Condvar,
    last_trim: Mutex<Option<SystemTime>>,
}

pub type ThumbnailHandle = Arc<ThumbnailState>;

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
        }),
        condvar: Condvar::new(),
        last_trim: Mutex::new(None),
    });

    let worker_count = std::thread::available_parallelism()
        .map(|value| value.get().saturating_sub(1).max(1))
        .unwrap_or(2);
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
    paths: Vec<String>,
    options: ThumbOptions,
    key: String,
) -> Vec<ThumbHit> {
    let mut hits = Vec::with_capacity(paths.len());

    for path in paths.into_iter().rev() {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let input_path = PathBuf::from(trimmed);
        let Some(kind) = select_thumbnail_kind(&input_path, &options) else {
            continue;
        };
        let metadata = match fs::metadata(&input_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if metadata.is_dir() {
            continue;
        }

        let (thumb_path, thumb_id) =
            build_thumb_path(&state.cache_dir, &input_path, &metadata, &key, &options.format);
        if thumb_path.exists() {
            hits.push(ThumbHit {
                path: trimmed.to_string(),
                thumb_path: thumb_path.to_string_lossy().to_string(),
                key: key.clone(),
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
            options: options.clone(),
            kind,
        });
        state.condvar.notify_one();
    }

    hits
}

fn worker_loop(state: ThumbnailHandle) {
    loop {
        let job = {
            let mut queue = state.queue.lock().expect("thumb queue lock");
            while queue.items.is_empty() {
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

        if let Ok(path) = result {
            maybe_trim_cache(&state.cache_dir, job.options.cache_mb, &state.last_trim);
            let payload = ThumbReady {
                path: job.path.to_string_lossy().to_string(),
                thumb_path: path.to_string_lossy().to_string(),
                key: job.key,
            };
            let _ = state.app_handle.emit("thumb_ready", payload);
        }
    }
}

fn render_thumbnail(job: &ThumbJob) -> Result<PathBuf, String> {
    if job.thumb_path.exists() {
        return Ok(job.thumb_path.clone());
    }
    let parent = job
        .thumb_path
        .parent()
        .ok_or_else(|| "invalid thumbnail path".to_string())?;
    fs::create_dir_all(parent).map_err(|err| err.to_string())?;

    let image = load_source_image(job)?;
    let resized = image.thumbnail(job.options.size, job.options.size);
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
    Ok(job.thumb_path.clone())
}

fn load_source_image(job: &ThumbJob) -> Result<image::DynamicImage, String> {
    match job.kind {
        ThumbKind::Image => image::open(&job.path).map_err(|err| err.to_string()),
        ThumbKind::Video => render_video_thumbnail(&job.path, job.options.size),
    }
}

#[cfg(target_os = "windows")]
// Use the shell thumbnail provider to keep video previews lightweight.
fn render_video_thumbnail(path: &Path, size: u32) -> Result<image::DynamicImage, String> {
    let _com = ComGuard::new()?;
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

fn maybe_trim_cache(cache_dir: &Path, limit_mb: u32, last_trim: &Mutex<Option<SystemTime>>) {
    if limit_mb == 0 {
        return;
    }
    let now = SystemTime::now();
    {
        let mut last = last_trim.lock().expect("thumb trim lock");
        if let Some(previous) = *last {
            if now.duration_since(previous).unwrap_or_default() < Duration::from_secs(30) {
                return;
            }
        }
        *last = Some(now);
    }

    let limit_bytes = limit_mb as u64 * 1024 * 1024;
    let (mut entries, mut total) = collect_cache_entries(cache_dir);
    if total <= limit_bytes {
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

fn build_thumb_path(
    cache_dir: &Path,
    input_path: &Path,
    metadata: &fs::Metadata,
    key: &str,
    format: &ThumbFormat,
) -> (PathBuf, String) {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input_path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    if let Some(modified) = metadata.modified().ok().and_then(to_epoch_ms) {
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
    let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("");
    let lower = ext.to_lowercase();
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
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "tif" | "tiff" | "ico"
    )
}

fn is_supported_video(extension: &str) -> bool {
    matches!(
        extension,
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "wmv" | "m4v" | "mpg" | "mpeg" | "flv"
            | "3gp" | "ogv"
    )
}
