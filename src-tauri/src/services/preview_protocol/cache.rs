// Cache validators and conditional-request helpers for preview responses.

use std::time::UNIX_EPOCH;

use tauri::http::{header, response::Builder as ResponseBuilder};

use super::http_dates::{format_http_date_from_unix_seconds, parse_http_date_seconds};

pub struct CacheValidators {
    pub etag: String,
    pub last_modified: Option<String>,
    pub modified_epoch_seconds: Option<i64>,
}

pub fn build_cache_validators(metadata: &std::fs::Metadata) -> CacheValidators {
    let modified_time = metadata.modified().ok();
    let modified_duration = modified_time.and_then(|value| value.duration_since(UNIX_EPOCH).ok());
    let modified_nanos = modified_duration
        .as_ref()
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let modified_epoch_seconds =
        modified_duration.and_then(|duration| i64::try_from(duration.as_secs()).ok());
    let last_modified = modified_epoch_seconds.and_then(format_http_date_from_unix_seconds);
    CacheValidators {
        // Strong validator keyed by file size + mtime precision.
        etag: format!("\"{:x}-{:x}\"", metadata.len(), modified_nanos),
        last_modified,
        modified_epoch_seconds,
    }
}

pub fn with_preview_cache_headers(
    builder: ResponseBuilder,
    validators: &CacheValidators,
) -> ResponseBuilder {
    let mut builder = builder
        .header(header::CACHE_CONTROL, super::PREVIEW_CACHE_CONTROL)
        .header(header::ETAG, validators.etag.as_str())
        .header(header::ACCEPT_RANGES, "bytes");
    if let Some(last_modified) = validators.last_modified.as_deref() {
        builder = builder.header(header::LAST_MODIFIED, last_modified);
    }
    builder
}

pub fn should_return_not_modified(
    if_none_match: Option<&str>,
    if_modified_since: Option<&str>,
    validators: &CacheValidators,
) -> bool {
    if let Some(if_none_match) = if_none_match {
        return etag_matches(if_none_match, validators.etag.as_str());
    }

    let Some(if_modified_since) = if_modified_since else {
        return false;
    };
    let Some(modified_seconds) = validators.modified_epoch_seconds else {
        return false;
    };
    let parsed_seconds = match parse_http_date_seconds(if_modified_since.trim()) {
        Ok(value) => value,
        Err(_) => return false,
    };
    modified_seconds <= parsed_seconds
}

fn etag_matches(header_value: &str, current_etag: &str) -> bool {
    let current = strip_weak_etag(current_etag.trim());
    header_value.split(',').any(|candidate| {
        let candidate = candidate.trim();
        if candidate == "*" {
            return true;
        }
        strip_weak_etag(candidate) == current
    })
}

fn strip_weak_etag(value: &str) -> &str {
    value.strip_prefix("W/").unwrap_or(value).trim()
}
