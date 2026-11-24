// Custom URI scheme for streaming full-resolution media previews.
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::Manager;

mod cache;
mod content_types;
mod grants;
mod http_dates;
mod range_requests;
mod responses;

use cache::{build_cache_validators, should_return_not_modified};
pub(crate) use grants::PreviewGrants;
use grants::PreviewSource;
use range_requests::{parse_range_header, ByteRange};
use responses::{
    error_response, head_response, not_modified_response, ok_response, partial_content_response,
    range_not_satisfiable,
};

const PREVIEW_SCHEME: &str = "stratum-preview";
// A revoked grant must never load from a WebView HTTP cache.
const PREVIEW_CACHE_CONTROL: &str = "no-store";
// A whole-file response is buffered by the protocol and the WebView.
const MAX_WHOLE_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;

pub fn register_preview_protocol<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    builder
        .manage(PreviewGrants::default())
        .plugin(preview_grant_lifecycle())
        .register_asynchronous_uri_scheme_protocol(
            PREVIEW_SCHEME,
            |ctx, request: Request<Vec<u8>>, responder: tauri::UriSchemeResponder| {
                let head_only = request.method() == Method::HEAD;
                if request.method() != Method::GET && !head_only {
                    let mut response = error_response(
                        StatusCode::METHOD_NOT_ALLOWED,
                        "Unsupported preview request method.".to_string(),
                    );
                    response
                        .headers_mut()
                        .insert(header::ALLOW, header::HeaderValue::from_static("GET, HEAD"));
                    responder.respond(response);
                    return;
                }
                let Some(source) = ctx
                    .app_handle()
                    .state::<PreviewGrants>()
                    .resolve(ctx.webview_label(), request.uri().path())
                else {
                    responder.respond(unavailable_grant());
                    return;
                };
                #[cfg(windows)]
                let audio_origin = request
                    .headers()
                    .get(header::ORIGIN)
                    .filter(|origin| {
                        if !source.content_type.starts_with("audio/") {
                            return false;
                        }
                        let url = origin
                            .to_str()
                            .ok()
                            .and_then(|value| tauri::Url::parse(value).ok());
                        let window = ctx.app_handle().get_webview_window(ctx.webview_label());
                        url.zip(window).is_some_and(|(url, window)| {
                            crate::platform::windows::webview_navigation::allows_app_navigation(
                                window.as_ref(),
                                &url,
                            )
                        })
                    })
                    .cloned();
                let range_header = request
                    .headers()
                    .get(header::RANGE)
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value.to_string());
                let if_none_match = request
                    .headers()
                    .get(header::IF_NONE_MATCH)
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value.to_string());
                let if_modified_since = request
                    .headers()
                    .get(header::IF_MODIFIED_SINCE)
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value.to_string());
                tauri::async_runtime::spawn_blocking(move || {
                    let response = build_file_response(
                        &source,
                        head_only,
                        range_header.as_deref(),
                        if_none_match.as_deref(),
                        if_modified_since.as_deref(),
                    );
                    // Only the issuing app origin can use its audio stream with Web Audio.
                    #[cfg(windows)]
                    let response = if let Some(origin) = audio_origin {
                        let mut response = response;
                        response
                            .headers_mut()
                            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
                        response
                            .headers_mut()
                            .append(header::VARY, header::HeaderValue::from_static("Origin"));
                        response
                    } else {
                        response
                    };
                    responder.respond(response);
                });
            },
        )
}

fn preview_grant_lifecycle<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri::{webview::PageLoadEvent, RunEvent, WindowEvent};

    tauri::plugin::Builder::new("preview-grants")
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Started) {
                webview
                    .state::<PreviewGrants>()
                    .revoke_webview(webview.label());
            }
        })
        .on_event(|app, event| {
            if let RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } = event
            {
                app.state::<PreviewGrants>().revoke_window(label);
            }
        })
        .build()
}

fn unavailable_grant() -> Response<Vec<u8>> {
    error_response(StatusCode::NOT_FOUND, "Preview is unavailable.".to_string())
}

fn build_file_response(
    source: &PreviewSource,
    head_only: bool,
    range_header: Option<&str>,
    if_none_match: Option<&str>,
    if_modified_since: Option<&str>,
) -> Response<Vec<u8>> {
    let content_type = source.content_type;
    let Ok(mut file) = source.file.lock() else {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Preview is unavailable.".into(),
        );
    };
    let Ok(metadata) = file.metadata() else {
        return error_response(
            StatusCode::NOT_FOUND,
            "Could not inspect preview file.".into(),
        );
    };
    let size = metadata.len();
    let validators = build_cache_validators(&metadata);

    if head_only {
        return head_response(content_type, size, &validators);
    }
    if let Some(range_header) = range_header {
        return build_range_response(&mut file, size, content_type, range_header, &validators);
    }
    if size > MAX_WHOLE_PREVIEW_BYTES {
        return preview_too_large();
    }

    // We only emit 304 for non-range requests. Media elements typically fetch with Range,
    // and returning 304 there would require additional If-Range handling.
    if should_return_not_modified(if_none_match, if_modified_since, &validators) {
        return not_modified_response(&validators);
    }

    // This handle is shared across full requests and video seeks.
    if file.rewind().is_err() {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to seek preview file.".into(),
        );
    }
    let data = match read_full_file(&mut *file) {
        Ok(data) => data,
        Err(response) => return response,
    };
    ok_response(content_type, data, &validators)
}

fn build_range_response(
    file: &mut File,
    size: u64,
    content_type: &'static str,
    range_header: &str,
    validators: &cache::CacheValidators,
) -> Response<Vec<u8>> {
    let range = match parse_range_header(range_header, size, content_type) {
        Ok(Some(range)) => range,
        Ok(None) | Err(_) => return range_not_satisfiable(size, validators),
    };
    let data = match read_file_range(file, range) {
        Ok(data) => data,
        Err(response) => return response,
    };
    partial_content_response(content_type, range.start, range.end, size, data, validators)
}

fn read_file_range(file: &mut File, range: ByteRange) -> Result<Vec<u8>, Response<Vec<u8>>> {
    let length_usize = usize::try_from(range.len()).map_err(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Requested range is too large.".to_string(),
        )
    })?;
    file.seek(SeekFrom::Start(range.start)).map_err(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to seek file.".to_string(),
        )
    })?;
    let mut buffer = vec![0u8; length_usize];
    file.read_exact(&mut buffer).map_err(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read file range.".to_string(),
        )
    })?;
    Ok(buffer)
}

fn read_full_file(file: impl Read) -> Result<Vec<u8>, Response<Vec<u8>>> {
    // The opened file may grow after its metadata was read.
    let mut data = Vec::new();
    file.take(MAX_WHOLE_PREVIEW_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|err| {
            error_response(StatusCode::NOT_FOUND, format!("Failed to read file: {err}"))
        })?;
    if data.len() as u64 > MAX_WHOLE_PREVIEW_BYTES {
        return Err(preview_too_large());
    }
    Ok(data)
}

fn preview_too_large() -> Response<Vec<u8>> {
    error_response(
        StatusCode::PAYLOAD_TOO_LARGE,
        "This file is too large to load in one preview request.".to_string(),
    )
}

#[cfg(test)]
mod tests {
    use std::{
        fs, io,
        path::{Path, PathBuf},
    };

    use super::content_types::content_type_for_path;
    use super::*;

    pub(super) struct PreviewFixture {
        directory: PathBuf,
        pub(super) path: PathBuf,
    }

    impl PreviewFixture {
        pub(super) fn new(case: &str) -> io::Result<Self> {
            let directory =
                std::env::temp_dir().join(format!("stratum-preview-{case}-{}", std::process::id()));
            fs::create_dir(&directory)?;
            let fixture = Self {
                path: directory.join("video.mp4"),
                directory,
            };
            fs::write(&fixture.path, b"video")?;
            Ok(fixture)
        }
    }

    impl Drop for PreviewFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn allows_media_while_rejecting_document_types() -> io::Result<()> {
        assert_eq!(
            content_type_for_path(Path::new("photo.PNG")),
            Some("image/png")
        );
        assert_eq!(
            content_type_for_path(Path::new("video.ogv")),
            Some("video/ogg")
        );
        let fixture = PreviewFixture::new("unsupported")?;
        let grants = PreviewGrants::default();
        for name in ["drawing.svg", "page.html", "notes.txt"] {
            let path = fixture.directory.join(name);
            fs::write(&path, b"document")?;
            assert!(open_grant(&grants, &path).is_err());
        }
        Ok(())
    }

    #[test]
    fn enforces_the_byte_ceiling_even_when_a_handle_grows() {
        assert_eq!(read_full_file(&b"image"[..]).unwrap(), b"image");
        let response = read_full_file(io::repeat(0)).unwrap_err();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[test]
    fn large_media_can_still_be_read_by_range() -> io::Result<()> {
        let fixture = PreviewFixture::new("large")?;
        File::options()
            .write(true)
            .open(&fixture.path)?
            .set_len(MAX_WHOLE_PREVIEW_BYTES + 1)?;
        let grants = PreviewGrants::default();
        let token = open_grant(&grants, &fixture.path).unwrap();
        let source = grants.resolve("main", &format!("/{token}")).unwrap();

        let response = build_file_response(&source, false, None, None, None);
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        let response = build_file_response(&source, true, None, None, None);
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.body().is_empty());
        let response = build_file_response(&source, false, Some("bytes=0-3"), None, None);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body().len(), 4);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "video/mp4");
        assert_eq!(
            response.headers()[header::X_CONTENT_TYPE_OPTIONS],
            "nosniff"
        );
        Ok(())
    }

    #[test]
    fn audio_previews_use_small_ranges_and_can_seek() -> io::Result<()> {
        let fixture = PreviewFixture::new("audio-range")?;
        let path = fixture.directory.join("recording.WAV");
        let length = 3 * 1024 * 1024;
        File::create(&path)?.set_len(length)?;
        let grants = PreviewGrants::default();
        let token = open_grant(&grants, &path).unwrap();
        let source = grants.resolve("main", &format!("/{token}")).unwrap();

        let first = build_file_response(&source, false, Some("bytes=0-"), None, None);
        assert_eq!(first.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(first.headers()[header::CONTENT_TYPE], "audio/wav");
        assert_eq!(first.body().len(), 1024 * 1024);
        let seek = build_file_response(&source, false, Some("bytes=3145720-"), None, None);
        assert_eq!(
            seek.headers()[header::CONTENT_RANGE],
            "bytes 3145720-3145727/3145728"
        );
        assert_eq!(seek.body().len(), 8);
        Ok(())
    }

    #[test]
    fn grants_are_scoped_to_the_issuing_webview_and_stop_after_release() -> io::Result<()> {
        let fixture = PreviewFixture::new("owner")?;
        let grants = PreviewGrants::default();
        let token = open_grant(&grants, &fixture.path).unwrap();
        let url_path = format!("/{token}");
        assert!(grants
            .resolve("main", &format!("/{}", fixture.path.display()))
            .is_none());
        assert!(grants.resolve("other", &url_path).is_none());
        grants.release("other", &token);
        assert!(grants.resolve("main", &url_path).is_some());
        grants.release("main", &token);
        assert!(grants.resolve("main", &url_path).is_none());
        Ok(())
    }

    #[test]
    fn repeated_reads_use_the_opened_file_even_when_the_path_is_replaced() -> io::Result<()> {
        let fixture = PreviewFixture::new("identity")?;
        let grants = PreviewGrants::default();
        let token = open_grant(&grants, &fixture.path).unwrap();
        let url_path = format!("/{token}");
        fs::rename(&fixture.path, fixture.directory.join("original.mp4"))?;
        fs::write(&fixture.path, b"replacement")?;
        let source = grants.resolve("main", &url_path).unwrap();
        let range = build_file_response(&source, false, Some("bytes=2-4"), None, None);
        assert_eq!(range.body(), b"deo");
        let whole = build_file_response(&source, false, None, None, None);
        assert_eq!(whole.body(), b"video");
        assert_eq!(whole.headers()[header::CACHE_CONTROL], "no-store");
        let replacement_token = open_grant(&grants, &fixture.path).unwrap();
        assert_ne!(token, replacement_token);
        let current = grants
            .resolve("main", &format!("/{replacement_token}"))
            .unwrap();
        assert_eq!(
            build_file_response(&current, false, None, None, None).body(),
            b"replacement"
        );
        Ok(())
    }

    fn open_grant(grants: &PreviewGrants, path: &Path) -> Result<String, String> {
        grants.create(grants.begin("main", "main")?, path)
    }
}
