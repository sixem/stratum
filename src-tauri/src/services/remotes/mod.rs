// App-scoped connections are keyed by a saved profile, independently of tab lifetime.
mod browse;
mod connection;
pub(crate) mod delete_recovery;
mod direct_events;
pub(crate) mod file;
pub(crate) mod open;
pub(crate) mod operations;
pub(crate) mod properties;
pub(crate) mod recovery;
pub(crate) mod recovery_review;
mod thumbnail;
pub(crate) mod transfer;
mod wire;

use browse::{check_path, read_directory, Entry};
use connection::Diagnostics;
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tauri::{Emitter, Manager, Webview};
use tokio::sync::{watch, Mutex as AsyncMutex, Semaphore};
use wire::{Error, Wire};

const DISCONNECTED: &str = "The remote host is disconnected. Reconnect to browse it.";
type Sessions = HashMap<String, Arc<Session>>;
type OnExit = Arc<dyn Fn(Disconnected) + Send + Sync>;

struct Session {
    host: String,
    start_path: String,
    id: u32,
    home: OnceLock<String>,
    wire: AsyncMutex<Wire>,
    diagnostics: Diagnostics,
    stop: watch::Sender<bool>,
    finished: watch::Receiver<bool>,
    thumbnail_slot: Semaphore,
}
// A cancelled future can leave an incomplete SFTP packet on the stream.
struct RetireOnCancel {
    stop: watch::Sender<bool>,
    armed: bool,
}
impl Drop for RetireOnCancel {
    fn drop(&mut self) {
        if self.armed {
            self.stop.send_replace(true);
        }
    }
}

impl Session {
    // A timeout cancels a partially read SFTP frame. Retire that connection
    // before releasing the stream lock to another tab.
    async fn complete<T>(
        &self,
        job: impl std::future::Future<Output = wire::Result<T>>,
        timeout_secs: u64,
    ) -> Result<T, String> {
        if *self.stop.borrow() || *self.finished.borrow() {
            return Err(DISCONNECTED.into());
        }
        let mut guard = RetireOnCancel {
            stop: self.stop.clone(),
            armed: true,
        };
        let mut stopped = self.stop.subscribe();
        let mut finished = self.finished.clone();
        let outcome = tokio::select! {
            result = tokio::time::timeout(Duration::from_secs(timeout_secs), job) => result,
            _ = stopped.wait_for(|stop| *stop) => {
                guard.armed = false;
                return Err(DISCONNECTED.into());
            }
            _ = finished.wait_for(|done| *done) => {
                guard.armed = false;
                return Err(DISCONNECTED.into());
            }
        };
        guard.armed = false;
        match outcome {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(Error::Transport(message))) => {
                self.stop.send_replace(true);
                if self.home.get().is_some() { Err(connection::failure(&self.diagnostics, &message)) }
                else { Err(message) }
            }
            Ok(Err(error)) => Err(error.message().into()),
            Err(_) => {
                self.stop.send_replace(true);
                Err("The SFTP operation timed out. Reconnect to try again.".into())
            }
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct Remotes(Arc<Mutex<Sessions>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Disconnected {
    profile_id: String,
    session_id: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Connected {
    path: String,
    session_id: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Listing {
    path: String,
    session_id: u32,
    entries: Vec<Entry>,
    omitted_entries: usize,
}

impl Remotes {
    pub(crate) fn clear(&self, label: &str) {
        if label == "main" {
            for (_, session) in self.0.lock().unwrap().drain() {
                session.stop.send_replace(true);
            }
        }
    }
    fn get_or_start(
        &self,
        id: &str,
        host: &str,
        start: &str,
        on_exit: OnExit,
    ) -> Result<Arc<Session>, String> {
        if id.is_empty() || id.len() > 128 || !connection::valid_host(host) {
            return Err("Invalid SSH profile or destination.".into());
        }
        check_path(start, true).map_err(|e| e.message().to_owned())?;
        let mut sessions = self.0.lock().unwrap();
        if let Some(session) = sessions.get(id) {
            if session.host != host || session.start_path != start {
                return Err("Disconnect before editing this remote host.".into());
            }
            if *session.stop.borrow() {
                return Err(DISCONNECTED.into());
            }
            return Ok(session.clone());
        }
        if sessions.len() >= 32 {
            return Err("Disconnect a host before opening another connection.".into());
        }
        let (mut child, wire, diagnostics) = connection::spawn(host)?;
        let process_id = child.id().ok_or("SSH could not start.")?;
        let (stop, mut stopping) = watch::channel(false);
        let (finish, finished) = watch::channel(false);
        let session = Arc::new(Session {
            host: host.into(),
            start_path: start.into(),
            id: process_id,
            home: OnceLock::new(),
            wire: AsyncMutex::new(wire),
            diagnostics,
            stop,
            finished,
            thumbnail_slot: Semaphore::new(1),
        });
        sessions.insert(id.into(), session.clone());
        let registry = Arc::downgrade(&self.0);
        let id = id.to_owned();
        tauri::async_runtime::spawn(async move {
            tokio::select! {
                _=child.wait()=>{},
                _=stopping.changed()=>{ let _=child.kill().await; }
            }
            if let Some(registry) = registry.upgrade() {
                let mut peers = registry.lock().unwrap();
                if peers.get(&id).is_some_and(|s| s.id == process_id) {
                    peers.remove(&id);
                }
            }
            finish.send_replace(true);
            on_exit(Disconnected {
                profile_id: id,
                session_id: process_id,
            });
        });
        Ok(session)
    }
    async fn connect(
        &self,
        id: &str,
        host: &str,
        start: &str,
        on_exit: OnExit,
    ) -> Result<Connected, String> {
        let session = self.get_or_start(id, host, start, on_exit)?;
        let mut wire = session.wire.lock().await;
        let path = session
            .complete(
                async {
                    if let Some(path) = session.home.get() {
                        return Ok(path.clone());
                    }
                    wire.init().await?;
                    let (path, _, _) = read_directory(&mut wire, start, true).await?;
                    let _ = session.home.set(path.clone());
                    Ok(path)
                },
                18,
            )
            .await;
        // A failed initial probe should never leave an unaffiliated SSH child.
        let path = match path {
            Ok(path) => path,
            Err(error) => {
                session.stop.send_replace(true);
                return Err(session.diagnostics.connection_error(&error).await);
            }
        };
        Ok(Connected {
            path,
            session_id: session.id,
        })
    }
    fn current(&self, id: &str, expected: Option<u32>) -> Result<Arc<Session>, String> {
        self.0
            .lock()
            .unwrap()
            .get(id)
            .filter(|s| s.home.get().is_some() && expected.is_none_or(|pid| pid == s.id))
            .cloned()
            .ok_or_else(|| DISCONNECTED.into())
    }
    async fn list(&self, id: &str, path: &str, expected: Option<u32>) -> Result<Listing, String> {
        check_path(path, false).map_err(|e| e.message().to_owned())?;
        let session = self.current(id, expected)?;
        let mut wire = session.wire.lock().await;
        let (path, entries, omitted_entries) = session
            .complete(read_directory(&mut wire, path, false), 60)
            .await?;
        Ok(Listing {
            path,
            entries,
            session_id: session.id,
            omitted_entries,
        })
    }
    async fn list_for_transfer(
        &self,
        id: &str,
        path: &str,
        expected: u32,
        checkpoint: &mut (dyn FnMut() -> Result<(), String> + Send),
    ) -> Result<Listing, String> {
        check_path(path, false).map_err(|e| e.message().to_owned())?;
        let session = self.current(id, Some(expected))?;
        let mut wire = session.wire.lock().await;
        let (path, entries, omitted_entries) = session
            .complete(
                browse::read_directory_controlled(&mut wire, path, false, &mut || {
                    checkpoint().map_err(Error::Request)
                }),
                60,
            )
            .await?;
        Ok(Listing {
            path,
            entries,
            session_id: session.id,
            omitted_entries,
        })
    }
    async fn stat(&self, id: &str, session_id: u32, path: &str) -> Result<wire::Attrs, String> {
        check_path(path, false).map_err(|e| e.message().to_owned())?;
        let session = self.current(id, Some(session_id))?;
        let mut wire = session.wire.lock().await;
        session
            .complete(
                async {
                    let packet = wire
                        .path_request(wire::Request::Lstat, path.as_bytes(), wire::Reply::Attrs)
                        .await?;
                    wire::Fields(&packet).attrs()
                },
                60,
            )
            .await
    }
    async fn exists(&self, id: &str, session_id: u32, path: &str) -> Result<bool, String> {
        check_path(path, false).map_err(|e| e.message().to_owned())?;
        let session = self.current(id, Some(session_id))?;
        let mut wire = session.wire.lock().await;
        session
            .complete(
                async {
                    match wire
                        .path_request(wire::Request::Lstat, path.as_bytes(), wire::Reply::Attrs)
                        .await
                    {
                        Ok(_) => Ok(true),
                        Err(wire::Error::NotFound) => Ok(false),
                        Err(error) => Err(error),
                    }
                },
                60,
            )
            .await
    }
    // The caller may cancel by dropping the future. An interrupted packet retires
    // the session, while cancellation before the stream is acquired leaves it usable.
    #[allow(dead_code)]
    pub(crate) async fn read_range(
        &self,
        id: &str,
        session_id: u32,
        path: &str,
        offset: u64,
        length: usize,
    ) -> Result<file::FileRange, String> {
        check_path(path, false).map_err(|e| e.message().to_owned())?;
        let session = self.current(id, Some(session_id))?;
        let mut wire = session.wire.lock().await;
        session
            .complete(file::read_range(&mut wire, path, offset, length), 60)
            .await
    }

    async fn disconnect(&self, id: &str) {
        let session = self.0.lock().unwrap().get(id).cloned();
        if let Some(session) = session {
            let mut finished = session.finished.clone();
            session.stop.send_replace(true);
            let _ = finished.wait_for(|done| *done).await;
        }
    }
}
fn manager(webview: &Webview) -> Result<Remotes, String> {
    if webview.label() != "main" {
        return Err("Remote folders are available in the main window.".into());
    }
    Ok(webview.state::<Remotes>().inner().clone())
}
#[tauri::command]
pub(crate) async fn remote_connect(
    webview: Webview,
    profile_id: String,
    host: String,
    start_path: String,
) -> Result<Connected, String> {
    let peers = manager(&webview)?;
    let app = webview.app_handle().clone();
    peers
        .connect(
            &profile_id,
            &host,
            &start_path,
            Arc::new(move |event| {
                let _ = app.emit_to("main", "remote-disconnected", event);
            }),
        )
        .await
}
#[tauri::command]
pub(crate) async fn remote_disconnect(webview: Webview, profile_id: String) -> Result<(), String> {
    manager(&webview)?.disconnect(&profile_id).await;
    Ok(())
}
#[tauri::command]
pub(crate) async fn remote_list(
    webview: Webview,
    profile_id: String,
    path: String,
    session_id: Option<u32>,
) -> Result<Listing, String> {
    manager(&webview)?
        .list(&profile_id, &path, session_id)
        .await
}
#[tauri::command]
pub(crate) async fn remote_resolve_target(
    webview: Webview,
    profile_id: String,
    session_id: u32,
    path: String,
) -> Result<browse::LinkTarget, String> {
    check_path(&path, false).map_err(|e| e.message().to_owned())?;
    let session = manager(&webview)?.current(&profile_id, Some(session_id))?;
    let mut wire = session.wire.lock().await;
    session
        .complete(browse::resolve_target(&mut wire, &path), 20)
        .await
}
#[tauri::command]
pub(crate) async fn remote_link_target(
    webview: Webview,
    profile_id: String,
    session_id: u32,
    path: String,
) -> Result<browse::LinkTarget, String> {
    check_path(&path, false).map_err(|e| e.message().to_owned())?;
    let session = manager(&webview)?.current(&profile_id, Some(session_id))?;
    let mut wire = session.wire.lock().await;
    session
        .complete(browse::link_target(&mut wire, &path), 20)
        .await
}
#[tauri::command]
pub(crate) async fn remote_thumbnail(
    webview: Webview,
    profile_id: String,
    path: String,
    session_id: Option<u32>,
    cache_mb: u32,
) -> Result<Option<String>, String> {
    check_path(&path, false).map_err(|e| e.message().to_owned())?;
    let session = manager(&webview)?.current(&profile_id, session_id)?;
    // Include time spent waiting for the SFTP connection in this request's
    // generation, so a cache clear also invalidates already queued work.
    let state = webview
        .state::<crate::domain::media::thumbs::ThumbnailHandle>()
        .inner()
        .clone();
    let generation = crate::domain::media::thumbs::remote_generation(&state);
    let _permit = session
        .thumbnail_slot
        .acquire()
        .await
        .map_err(|_| DISCONNECTED.to_owned())?;

    let identity = {
        let mut wire = session.wire.lock().await;
        session
            .complete(thumbnail::identity(&mut wire, &session.host, &path), 20)
            .await?
    };
    if let Some(ref identity) = identity {
        let cache = state.clone();
        let key = identity.clone();
        if let Ok(Some(bytes)) = tokio::task::spawn_blocking(move || {
            crate::domain::media::thumbs::remote_cached(&cache, &key)
        })
        .await
        {
            use base64::{engine::general_purpose::STANDARD, Engine};
            return Ok(Some(format!(
                "data:image/webp;base64,{}",
                STANDARD.encode(bytes)
            )));
        }
    }
    let data = {
        let mut wire = session.wire.lock().await;
        session
            .complete(thumbnail::read(&mut wire, &path), 20)
            .await?
    };
    let confirmed_identity = if data.is_some() && identity.is_some() {
        let mut wire = session.wire.lock().await;
        session
            .complete(thumbnail::identity(&mut wire, &session.host, &path), 20)
            .await?
    } else {
        None
    };
    let identity = identity.filter(|key| confirmed_identity.as_ref() == Some(key));
    match data {
        Some(data) => tokio::task::spawn_blocking(move || {
            use base64::{engine::general_purpose::STANDARD, Engine};
            let image = thumbnail::decode(data)?;
            if let (Some(identity), Some(encoded)) =
                (identity, image.strip_prefix("data:image/webp;base64,"))
            {
                if let Ok(bytes) = STANDARD.decode(encoded) {
                    crate::domain::media::thumbs::store_remote(
                        &state, &identity, &bytes, cache_mb, generation,
                    );
                }
            }
            Some(image)
        })
        .await
        .map_err(|_| "Could not decode thumbnail.".into()),
        None => Ok(None),
    }
}

#[tauri::command]
pub(crate) async fn create_remote_preview_grant(
    webview: Webview,
    profile_id: String,
    session_id: u32,
    path: String,
) -> Result<String, String> {
    check_path(&path, false).map_err(|e| e.message().to_owned())?;
    let remotes = manager(&webview)?;
    let grants = webview
        .state::<crate::services::preview_protocol::PreviewGrants>()
        .inner()
        .clone();
    let request = grants.begin(webview.label(), webview.window().label())?;
    let cache_generation = crate::domain::media::thumbs::remote_generation(
        &webview.state::<crate::domain::media::thumbs::ThumbnailHandle>(),
    );
    let metadata = remotes
        .read_range(&profile_id, session_id, &path, 0, 0)
        .await?;
    grants.create_remote(
        request,
        crate::services::preview_protocol::RemoteSource {
            remotes,
            profile_id,
            session_id,
            path,
            size: metadata.size,
            modified: metadata.modified,
            cache_generation,
            thumbnail: None,
        },
    )
}

// A gallery image was already decoded by the WebView. Store only its small,
// revalidated frame; never download the original again for this operation.
#[tauri::command]
pub(crate) async fn store_remote_gallery_thumbnail(
    webview: Webview,
    token: String,
    image: String,
    cache_mb: u32,
) -> Result<bool, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let grants = webview
        .state::<crate::services::preview_protocol::PreviewGrants>()
        .inner()
        .clone();
    let remote = grants
        .remote_source(webview.label(), &token)
        .ok_or("Preview has expired.")?;
    if remote.thumbnail.is_some()
        || !thumbnail::supported(&remote.path)
        || remote.modified.is_none()
    {
        return Ok(false);
    }
    let encoded = image
        .strip_prefix("data:image/jpeg;base64,")
        .ok_or("Invalid thumbnail.")?;
    if encoded.len() > 256 * 1024 {
        return Err("Thumbnail is too large.".into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| "Invalid thumbnail.")?;
    let metadata = remote
        .remotes
        .read_range(&remote.profile_id, remote.session_id, &remote.path, 0, 0)
        .await?;
    if metadata.size != remote.size || metadata.modified != remote.modified {
        return Ok(false);
    }
    let session = remote
        .remotes
        .current(&remote.profile_id, Some(remote.session_id))?;
    let identity = format!(
        "v1\0{}\0{}\0{}\0{}",
        session.host,
        remote.path,
        remote.size,
        remote.modified.unwrap()
    );
    let state = webview
        .state::<crate::domain::media::thumbs::ThumbnailHandle>()
        .inner()
        .clone();
    tokio::task::spawn_blocking(move || {
        let Some(image) = thumbnail::decode(bytes) else {
            return false;
        };
        let Some(encoded) = image.strip_prefix("data:image/webp;base64,") else {
            return false;
        };
        let Ok(bytes) = STANDARD.decode(encoded) else {
            return false;
        };
        crate::domain::media::thumbs::store_remote(
            &state,
            &identity,
            &bytes,
            cache_mb,
            remote.cache_generation,
        );
        crate::domain::media::thumbs::remote_generation(&state) == remote.cache_generation
    })
    .await
    .map_err(|_| "Could not store thumbnail.".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoThumbnailRequest {
    token: Option<String>,
    cached: Option<String>,
}

#[tauri::command]
pub(crate) async fn prepare_remote_video_thumbnail(
    webview: Webview,
    profile_id: String,
    session_id: u32,
    path: String,
) -> Result<VideoThumbnailRequest, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    check_path(&path, false).map_err(|e| e.message().to_owned())?;
    let is_video = crate::services::preview_protocol::content_types::content_type_for_path(
        std::path::Path::new(&path),
    )
    .is_some_and(|kind| kind.starts_with("video/"));
    if !is_video {
        return Err("Unsupported video.".into());
    }
    let remotes = manager(&webview)?;
    let session = remotes.current(&profile_id, Some(session_id))?;
    let state = webview
        .state::<crate::domain::media::thumbs::ThumbnailHandle>()
        .inner()
        .clone();
    let generation = crate::domain::media::thumbs::remote_generation(&state);
    let grants = webview
        .state::<crate::services::preview_protocol::PreviewGrants>()
        .inner()
        .clone();
    let request = grants.begin(webview.label(), webview.window().label())?;
    let metadata = remotes
        .read_range(&profile_id, session_id, &path, 0, 0)
        .await?;
    let modified = metadata.modified.ok_or("Video metadata is unavailable.")?;
    if metadata.size == 0 {
        return Err("The video is empty.".into());
    }
    let identity = format!(
        "video-v1\0{}\0{}\0{}\0{}",
        session.host, path, metadata.size, modified
    );
    let cache = state.clone();
    let key = identity.clone();
    if let Ok(Some(bytes)) = tokio::task::spawn_blocking(move || {
        crate::domain::media::thumbs::remote_cached(&cache, &key)
    })
    .await
    {
        return Ok(VideoThumbnailRequest {
            token: None,
            cached: Some(format!("data:image/webp;base64,{}", STANDARD.encode(bytes))),
        });
    }
    let token = grants.create_remote(
        request,
        crate::services::preview_protocol::RemoteSource {
            remotes,
            profile_id,
            session_id,
            path,
            size: metadata.size,
            modified: metadata.modified,
            cache_generation: generation,
            thumbnail: Some(Arc::new(
                crate::services::preview_protocol::VideoThumbnail {
                    identity,
                    generation,
                    remaining: std::sync::atomic::AtomicU64::new(8 * 1024 * 1024),
                },
            )),
        },
    )?;
    Ok(VideoThumbnailRequest {
        token: Some(token),
        cached: None,
    })
}

#[tauri::command]
pub(crate) async fn store_remote_video_thumbnail(
    webview: Webview,
    token: String,
    image: String,
    cache_mb: u32,
) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let grants = webview
        .state::<crate::services::preview_protocol::PreviewGrants>()
        .inner()
        .clone();
    let remote = grants
        .thumbnail_source(webview.label(), &token)
        .ok_or("Thumbnail has expired.")?;
    let encoded = image
        .strip_prefix("data:image/jpeg;base64,")
        .ok_or("Invalid thumbnail.")?;
    if encoded.len() > 256 * 1024 {
        return Err("Thumbnail is too large.".into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| "Invalid thumbnail.")?;
    let metadata = remote
        .remotes
        .read_range(&remote.profile_id, remote.session_id, &remote.path, 0, 0)
        .await?;
    if metadata.size != remote.size || metadata.modified != remote.modified {
        return Ok(None);
    }
    let state = webview
        .state::<crate::domain::media::thumbs::ThumbnailHandle>()
        .inner()
        .clone();
    let thumb = remote.thumbnail.ok_or("Thumbnail has expired.")?;
    tokio::task::spawn_blocking(move || {
        let image = thumbnail::decode(bytes)?;
        let bytes = STANDARD
            .decode(image.strip_prefix("data:image/webp;base64,")?)
            .ok()?;
        crate::domain::media::thumbs::store_remote(
            &state,
            &thumb.identity,
            &bytes,
            cache_mb,
            thumb.generation,
        );
        Some(image)
    })
    .await
    .map_err(|_| "Could not store thumbnail.".into())
}

#[cfg(test)]
mod tests;
