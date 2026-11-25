// Thumbnail generation pipeline: queueing, request preparation, rendering,
// and cache management. The public API stays small so the rest of the app can
// treat thumbnails as one service while the internals stay split by concern.
mod cache;
mod queue;
mod render;
mod request;
mod types;
#[cfg(target_os = "windows")]
mod windows;

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::SystemTime;

use tauri::{AppHandle, Emitter};

#[cfg(target_os = "windows")]
use crate::platform::windows::com::StaComGuard;

use queue::ThumbQueue;
pub use types::{
    ThumbFormat, ThumbHit, ThumbOptions, ThumbReady, ThumbRequest, ThumbScope, ThumbView,
};

#[derive(Clone, Copy)]
enum ThumbKind {
    Image,
    Video,
    Svg,
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

struct CacheTrimState {
    last_trim: Option<SystemTime>,
    approx_total_bytes: Option<u64>,
    pending_growth_bytes: u64,
}

struct ThumbRenderOutput {
    path: PathBuf,
    added_bytes: u64,
}

pub struct ThumbnailState {
    app_handle: AppHandle,
    cache_dir: PathBuf,
    queue: Mutex<ThumbQueue>,
    condvar: Condvar,
    trim_state: Mutex<CacheTrimState>,
    // Serialize trimming and clearing without holding the growth accounting lock during I/O.
    cache_maintenance: Mutex<()>,
}

pub type ThumbnailHandle = Arc<ThumbnailState>;

const MAX_THUMB_WORKERS: usize = 3;
const MAX_THUMB_SIZE: u32 = 320;
const TRIM_SCAN_INTERVAL_SECS: u64 = 30;
const TRIM_SCAN_THRESHOLD_PERCENT: u64 = 85;
const TRIM_UNKNOWN_SCAN_GROWTH_BYTES: u64 = 32 * 1024 * 1024;

pub fn init(app_handle: AppHandle) -> ThumbnailHandle {
    let cache_dir = cache::resolve_cache_dir(&app_handle);
    if let Err(err) = fs::create_dir_all(&cache_dir) {
        eprintln!("thumb cache init failed: {err}");
    }

    let state = Arc::new(ThumbnailState {
        app_handle,
        cache_dir,
        queue: Mutex::new(ThumbQueue::default()),
        condvar: Condvar::new(),
        trim_state: Mutex::new(CacheTrimState {
            last_trim: None,
            approx_total_bytes: None,
            pending_growth_bytes: 0,
        }),
        cache_maintenance: Mutex::new(()),
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
    scope: ThumbScope,
) -> Vec<ThumbHit> {
    request::request_thumbnails(state, requests, options, key, scope)
}

pub fn open_scope(state: &ThumbnailState, view: ThumbView) -> ThumbScope {
    state
        .queue
        .lock()
        .expect("thumb queue lock")
        .open_scope(view)
}

pub fn close_scope(state: &ThumbnailState, scope: ThumbScope) {
    state
        .queue
        .lock()
        .expect("thumb queue lock")
        .close_scope(scope);
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

pub fn get_cache_dir(app_handle: &AppHandle) -> PathBuf {
    cache::get_cache_dir(app_handle)
}

pub fn clear_cache(state: &ThumbnailState) -> Result<(), String> {
    cache::clear_cache(state)
}

pub fn get_cache_size(app_handle: &AppHandle) -> Result<u64, String> {
    cache::get_cache_size(app_handle)
}

fn worker_loop(state: ThumbnailHandle) {
    #[cfg(target_os = "windows")]
    // Initialize COM once per worker thread so video thumbnail jobs avoid per-item setup.
    let _com_guard = match StaComGuard::new() {
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
        let result = render::render_thumbnail(&job);

        {
            let mut queue = state.queue.lock().expect("thumb queue lock");
            queue.finish(&job);
        }

        if let Ok(output) = result {
            let payload = ThumbReady {
                path: job.path.to_string_lossy().to_string(),
                thumb_path: output.path.to_string_lossy().to_string(),
                key: job.key,
                signature: job.signature,
            };
            let _ = state.app_handle.emit("thumb_ready", payload);
            cache::maybe_trim_cache(state.as_ref(), job.options.cache_mb, output.added_bytes);
        }
    }
}
