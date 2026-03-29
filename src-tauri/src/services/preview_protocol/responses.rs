// Shared response builders for the preview protocol.
// These helpers keep the service focused on high-level request branching.

use tauri::http::{header, Response, StatusCode};

use super::cache::{with_preview_cache_headers, CacheValidators};

pub fn error_response(status: StatusCode, message: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .header(header::CACHE_CONTROL, "no-store")
        .body(message.into_bytes())
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Vec::new())
                .unwrap()
        })
}

pub fn not_modified_response(validators: &CacheValidators) -> Response<Vec<u8>> {
    with_preview_cache_headers(
        Response::builder().status(StatusCode::NOT_MODIFIED),
        validators,
    )
    .body(Vec::new())
    .unwrap_or_else(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Bad response.".to_string(),
        )
    })
}

pub fn range_not_satisfiable(size: u64, validators: &CacheValidators) -> Response<Vec<u8>> {
    with_preview_cache_headers(
        Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{size}")),
        validators,
    )
    .body(Vec::new())
    .unwrap_or_else(|_| {
        Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new())
            .unwrap()
    })
}

pub fn ok_response(
    content_type: &'static str,
    data: Vec<u8>,
    validators: &CacheValidators,
) -> Response<Vec<u8>> {
    with_preview_cache_headers(
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_LENGTH, data.len().to_string()),
        validators,
    )
    .body(data)
    .unwrap_or_else(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Bad response.".to_string(),
        )
    })
}

pub fn partial_content_response(
    content_type: &'static str,
    start: u64,
    end: u64,
    size: u64,
    data: Vec<u8>,
    validators: &CacheValidators,
) -> Response<Vec<u8>> {
    with_preview_cache_headers(
        Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
            .header(header::CONTENT_LENGTH, data.len().to_string()),
        validators,
    )
    .body(data)
    .unwrap_or_else(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Bad response.".to_string(),
        )
    })
}
