// Custom URI scheme for streaming full-resolution media previews.
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use tauri::http::{header, Request, Response, StatusCode};

mod cache;
mod content_types;
mod http_dates;
mod percent_decode;
mod range_requests;
mod responses;

use cache::{build_cache_validators, should_return_not_modified};
use content_types::content_type_for_path;
use percent_decode::decode_path;
use range_requests::{parse_range_header, ByteRange};
use responses::{
    error_response, not_modified_response, ok_response, partial_content_response,
    range_not_satisfiable,
};

const PREVIEW_SCHEME: &str = "stratum-preview";
const PREVIEW_CACHE_CONTROL: &str = "private, max-age=0, must-revalidate";

pub fn register_preview_protocol<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol(
        PREVIEW_SCHEME,
        |_ctx, request: Request<Vec<u8>>, responder: tauri::UriSchemeResponder| {
            let raw_path = request.uri().path().to_string();
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
                let response = build_response(
                    &raw_path,
                    range_header.as_deref(),
                    if_none_match.as_deref(),
                    if_modified_since.as_deref(),
                );
                responder.respond(response);
            });
        },
    )
}

fn build_response(
    raw_path: &str,
    range_header: Option<&str>,
    if_none_match: Option<&str>,
    if_modified_since: Option<&str>,
) -> Response<Vec<u8>> {
    let path = match resolve_request_path(raw_path) {
        Ok(path) => path,
        Err(response) => return response,
    };

    let metadata = match read_file_metadata(&path) {
        Ok(metadata) => metadata,
        Err(response) => return response,
    };
    let size = metadata.len();
    let validators = build_cache_validators(&metadata);

    // We only emit 304 for non-range requests. Media elements typically fetch with Range,
    // and returning 304 there would require additional If-Range handling.
    if range_header.is_none()
        && should_return_not_modified(if_none_match, if_modified_since, &validators)
    {
        return not_modified_response(&validators);
    }

    let content_type = content_type_for_path(&path);
    if let Some(range_header) = range_header {
        return build_range_response(&path, size, content_type, range_header, &validators);
    }

    let data = match read_full_file(&path) {
        Ok(data) => data,
        Err(response) => return response,
    };
    ok_response(content_type, data, &validators)
}

fn resolve_request_path(raw_path: &str) -> Result<PathBuf, Response<Vec<u8>>> {
    let path = decode_path(raw_path)
        .map(PathBuf::from)
        .map_err(|message| error_response(StatusCode::BAD_REQUEST, message))?;
    if !path.is_absolute() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Path must be absolute.".to_string(),
        ));
    }
    Ok(path)
}

fn read_file_metadata(path: &Path) -> Result<std::fs::Metadata, Response<Vec<u8>>> {
    let metadata = std::fs::metadata(path).map_err(|err| {
        error_response(
            StatusCode::NOT_FOUND,
            format!("Failed to read file metadata: {err}"),
        )
    })?;
    if !metadata.is_file() {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "Path is not a file.".to_string(),
        ));
    }
    Ok(metadata)
}

fn build_range_response(
    path: &Path,
    size: u64,
    content_type: &'static str,
    range_header: &str,
    validators: &cache::CacheValidators,
) -> Response<Vec<u8>> {
    let range = match parse_range_header(range_header, size) {
        Ok(Some(range)) => range,
        Ok(None) | Err(_) => return range_not_satisfiable(size, validators),
    };
    let data = match read_file_range(path, range) {
        Ok(data) => data,
        Err(response) => return response,
    };
    partial_content_response(
        content_type,
        range.start,
        range.end,
        size,
        data,
        validators,
    )
}

fn read_file_range(path: &Path, range: ByteRange) -> Result<Vec<u8>, Response<Vec<u8>>> {
    let length_usize = usize::try_from(range.len()).map_err(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Requested range is too large.".to_string(),
        )
    })?;
    let mut file = std::fs::File::open(path).map_err(|err| {
        error_response(StatusCode::NOT_FOUND, format!("Failed to read file: {err}"))
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

fn read_full_file(path: &Path) -> Result<Vec<u8>, Response<Vec<u8>>> {
    std::fs::read(path)
        .map_err(|err| error_response(StatusCode::NOT_FOUND, format!("Failed to read file: {err}")))
}
