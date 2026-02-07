// Custom URI scheme for streaming full-resolution media previews.
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use tauri::http::{header, Request, Response, StatusCode};

const PREVIEW_SCHEME: &str = "stratum-preview";

// Tauri URI scheme handlers must return a fully-buffered `Vec<u8>` as the response body.
// For media playback the webview often uses `Range: bytes=...` requests and expects the
// server to *stream* the bytes progressively. Without streaming, a request like `bytes=0-`
// would force us to read the entire file before the video element sees any data, which makes
// long videos feel like they "take forever" to load or seek.
//
// To keep previews responsive and memory usage bounded, we cap how many bytes we return per
// request. The webview will issue follow-up range requests as needed.
const MAX_RANGE_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
struct ByteRange {
    start: u64,
    end: u64,
}

impl ByteRange {
    fn len(self) -> u64 {
        self.end.saturating_sub(self.start).saturating_add(1)
    }
}

pub fn register_preview_protocol<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol(
        PREVIEW_SCHEME,
        |_ctx, request: Request<Vec<u8>>, responder: tauri::UriSchemeResponder| {
            let raw_path = request.uri().path().to_string();
            let range_header = request
                .headers()
                .get(header::RANGE)
                .and_then(|value| value.to_str().ok())
                .map(|value| value.to_string());
            tauri::async_runtime::spawn_blocking(move || {
                let response = build_response(&raw_path, range_header.as_deref());
                responder.respond(response);
            });
        },
    )
}

fn build_response(raw_path: &str, range_header: Option<&str>) -> Response<Vec<u8>> {
    let path = match decode_path(raw_path) {
        Ok(value) => value,
        Err(message) => return error_response(StatusCode::BAD_REQUEST, message),
    };

    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return error_response(StatusCode::BAD_REQUEST, "Path must be absolute.".to_string());
    }

    let metadata = match std::fs::metadata(&path) {
        Ok(info) => info,
        Err(err) => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Failed to read file metadata: {err}"),
            )
        }
    };
    if !metadata.is_file() {
        return error_response(StatusCode::NOT_FOUND, "Path is not a file.".to_string());
    }
    let size = metadata.len();

    let content_type = content_type_for_path(&path);
    if let Some(range_header) = range_header {
        match parse_range_header(range_header, size) {
            Ok(Some(range)) => {
                let start = range.start;
                let end = range.end;
                let length = range.len();
                let length_usize = match usize::try_from(length) {
                    Ok(value) => value,
                    Err(_) => {
                        return error_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Requested range is too large.".to_string(),
                        )
                    }
                };
                let mut file = match std::fs::File::open(&path) {
                    Ok(file) => file,
                    Err(err) => {
                        return error_response(
                            StatusCode::NOT_FOUND,
                            format!("Failed to read file: {err}"),
                        )
                    }
                };
                if file.seek(SeekFrom::Start(start)).is_err() {
                    return error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to seek file.".to_string(),
                    );
                }
                let mut buffer = vec![0u8; length_usize];
                if file.read_exact(&mut buffer).is_err() {
                    return error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to read file range.".to_string(),
                    );
                }
                return Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_TYPE, content_type)
                    .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
                    .header(header::CONTENT_LENGTH, buffer.len().to_string())
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::CACHE_CONTROL, "no-store")
                    .body(buffer)
                    .unwrap_or_else(|_| {
                        error_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Bad response.".to_string(),
                        )
                    });
            }
            Ok(None) => {
                return range_not_satisfiable(size);
            }
            Err(_) => {
                return range_not_satisfiable(size);
            }
        }
    }

    let data = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) => {
            return error_response(
                StatusCode::NOT_FOUND,
                format!("Failed to read file: {err}"),
            )
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, data.len().to_string())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .body(data)
        .unwrap_or_else(|_| {
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "Bad response.".to_string())
        })
}

fn error_response(status: StatusCode, message: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .header(header::CACHE_CONTROL, "no-store")
        .body(message.into_bytes())
        .unwrap_or_else(|_| Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR).body(Vec::new()).unwrap())
}

fn range_not_satisfiable(size: u64) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(header::CONTENT_RANGE, format!("bytes */{size}"))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR).body(Vec::new()).unwrap())
}

fn decode_path(raw_path: &str) -> Result<String, String> {
    let trimmed = raw_path.trim_start_matches('/');
    if trimmed.is_empty() {
        return Err("Missing path.".to_string());
    }
    // Decode the percent-escaped path so Windows paths round-trip correctly.
    decode_component(trimmed)
}

// Minimal percent decoder to avoid extra dependencies in the protocol handler.
fn decode_component(value: &str) -> Result<String, String> {
    let mut bytes = Vec::with_capacity(value.len());
    let mut iter = value.as_bytes().iter().copied();
    while let Some(byte) = iter.next() {
        match byte {
            b'%' => {
                let high = iter.next().ok_or_else(|| "Incomplete percent encoding.".to_string())?;
                let low = iter.next().ok_or_else(|| "Incomplete percent encoding.".to_string())?;
                let high_val = hex_value(high).ok_or_else(|| "Invalid percent encoding.".to_string())?;
                let low_val = hex_value(low).ok_or_else(|| "Invalid percent encoding.".to_string())?;
                bytes.push((high_val << 4) | low_val);
            }
            // Unlike query strings, URL paths do not treat '+' as a space.
            _ => bytes.push(byte),
        }
    }
    String::from_utf8(bytes).map_err(|_| "Invalid UTF-8 in path.".to_string())
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn content_type_for_path(path: &Path) -> &'static str {
    let ext = match path.extension().and_then(|value| value.to_str()) {
        Some(value) => value.to_ascii_lowercase(),
        None => return "application/octet-stream",
    };

    match ext.as_str() {
        "jpg" | "jpeg" | "jpe" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "wmv" => "video/x-ms-wmv",
        "mpeg" | "mpg" | "mpe" => "video/mpeg",
        _ => "application/octet-stream",
    }
}

fn parse_range_header(header_value: &str, size: u64) -> Result<Option<ByteRange>, ()> {
    if size == 0 {
        return Ok(None);
    }

    let range_set = header_value.trim();
    let range_set = match range_set.strip_prefix("bytes=") {
        Some(value) => value,
        None => return Err(()),
    };

    // Browsers may send multiple ranges (comma-separated). Our preview use-case only needs
    // the first range, and serving a multipart/byteranges response would require building a
    // custom MIME payload. Keeping this simple avoids extra allocations and complexity.
    let first_range = range_set.split(',').next().unwrap_or("").trim();
    let (start_part, end_part) = match first_range.split_once('-') {
        Some(parts) => parts,
        None => return Err(()),
    };

    let start_part = start_part.trim();
    let end_part = end_part.trim();

    if start_part.is_empty() {
        // Suffix range ("-N"): last N bytes.
        let suffix_len: u64 = end_part.parse().map_err(|_| ())?;
        if suffix_len == 0 {
            return Ok(None);
        }
        let suffix_len = suffix_len.min(size).min(MAX_RANGE_RESPONSE_BYTES);
        let start = size.saturating_sub(suffix_len);
        let end = size - 1;
        return Ok(Some(ByteRange { start, end }));
    }

    let start: u64 = start_part.parse().map_err(|_| ())?;
    if start >= size {
        return Ok(None);
    }

    let requested_end = if end_part.is_empty() {
        size - 1
    } else {
        let parsed: u64 = end_part.parse().map_err(|_| ())?;
        parsed.min(size - 1)
    };

    if requested_end < start {
        return Ok(None);
    }

    // Cap the response size to avoid reading extremely large ranges into memory.
    let max_end = start
        .saturating_add(MAX_RANGE_RESPONSE_BYTES.saturating_sub(1))
        .min(size - 1);
    let end = requested_end.min(max_end);

    Ok(Some(ByteRange { start, end }))
}
