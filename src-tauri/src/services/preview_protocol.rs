// Custom URI scheme for streaming full-resolution media previews.
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use tauri::http::{header, response::Builder as ResponseBuilder, Request, Response, StatusCode};

const PREVIEW_SCHEME: &str = "stratum-preview";
const PREVIEW_CACHE_CONTROL: &str = "private, max-age=0, must-revalidate";

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

struct CacheValidators {
    etag: String,
    last_modified: Option<String>,
    modified_epoch_seconds: Option<i64>,
}

impl ByteRange {
    fn len(self) -> u64 {
        self.end.saturating_sub(self.start).saturating_add(1)
    }
}

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
    let path = match decode_path(raw_path) {
        Ok(value) => value,
        Err(message) => return error_response(StatusCode::BAD_REQUEST, message),
    };

    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Path must be absolute.".to_string(),
        );
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
                return with_preview_cache_headers(
                    Response::builder()
                        .status(StatusCode::PARTIAL_CONTENT)
                        .header(header::CONTENT_TYPE, content_type)
                        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
                        .header(header::CONTENT_LENGTH, buffer.len().to_string()),
                    &validators,
                )
                .body(buffer)
                .unwrap_or_else(|_| {
                    error_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Bad response.".to_string(),
                    )
                });
            }
            Ok(None) => {
                return range_not_satisfiable(size, &validators);
            }
            Err(_) => {
                return range_not_satisfiable(size, &validators);
            }
        }
    }

    let data = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) => {
            return error_response(StatusCode::NOT_FOUND, format!("Failed to read file: {err}"))
        }
    };

    with_preview_cache_headers(
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_LENGTH, data.len().to_string()),
        &validators,
    )
    .body(data)
    .unwrap_or_else(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Bad response.".to_string(),
        )
    })
}

fn error_response(status: StatusCode, message: String) -> Response<Vec<u8>> {
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

fn range_not_satisfiable(size: u64, validators: &CacheValidators) -> Response<Vec<u8>> {
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

fn build_cache_validators(metadata: &std::fs::Metadata) -> CacheValidators {
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

fn with_preview_cache_headers(
    builder: ResponseBuilder,
    validators: &CacheValidators,
) -> ResponseBuilder {
    let mut builder = builder
        .header(header::CACHE_CONTROL, PREVIEW_CACHE_CONTROL)
        .header(header::ETAG, validators.etag.as_str())
        .header(header::ACCEPT_RANGES, "bytes");
    if let Some(last_modified) = validators.last_modified.as_deref() {
        builder = builder.header(header::LAST_MODIFIED, last_modified);
    }
    builder
}

fn should_return_not_modified(
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

fn not_modified_response(validators: &CacheValidators) -> Response<Vec<u8>> {
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

fn format_http_date_from_unix_seconds(total_seconds: i64) -> Option<String> {
    if total_seconds < 0 {
        return None;
    }
    let seconds_per_day = 86_400_i64;
    let days = total_seconds / seconds_per_day;
    let day_seconds = total_seconds % seconds_per_day;

    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;

    let (year, month, day) = civil_from_days(days)?;
    let month_name = month_name(month)?;
    let weekday_name = weekday_name(days)?;
    Some(format!(
        "{weekday_name}, {day:02} {month_name} {year:04} {hour:02}:{minute:02}:{second:02} GMT"
    ))
}

fn parse_http_date_seconds(value: &str) -> Result<i64, ()> {
    // IMF-fixdate: "Wed, 21 Oct 2015 07:28:00 GMT"
    let mut parts = value.split_whitespace();
    let weekday = parts.next().ok_or(())?;
    let day = parts.next().ok_or(())?;
    let month = parts.next().ok_or(())?;
    let year = parts.next().ok_or(())?;
    let time = parts.next().ok_or(())?;
    let zone = parts.next().ok_or(())?;
    if parts.next().is_some() {
        return Err(());
    }
    if !weekday.ends_with(',') || zone != "GMT" {
        return Err(());
    }

    let day: u32 = day.parse().map_err(|_| ())?;
    let month = month_number(month).ok_or(())?;
    let year: i32 = year.parse().map_err(|_| ())?;
    let (hour, minute, second) = parse_time_components(time).ok_or(())?;
    if hour > 23 || minute > 59 || second > 59 {
        return Err(());
    }

    let days = days_from_civil(year, month, day).ok_or(())?;
    let (check_year, check_month, check_day) = civil_from_days(days).ok_or(())?;
    if check_year != year || check_month != month || check_day != day {
        return Err(());
    }

    let total = days
        .checked_mul(86_400)
        .and_then(|value| value.checked_add(i64::from(hour) * 3_600))
        .and_then(|value| value.checked_add(i64::from(minute) * 60))
        .and_then(|value| value.checked_add(i64::from(second)))
        .ok_or(())?;
    if total < 0 {
        return Err(());
    }
    Ok(total)
}

fn parse_time_components(value: &str) -> Option<(u32, u32, u32)> {
    let mut split = value.split(':');
    let hour: u32 = split.next()?.parse().ok()?;
    let minute: u32 = split.next()?.parse().ok()?;
    let second: u32 = split.next()?.parse().ok()?;
    if split.next().is_some() {
        return None;
    }
    Some((hour, minute, second))
}

fn month_name(value: u32) -> Option<&'static str> {
    match value {
        1 => Some("Jan"),
        2 => Some("Feb"),
        3 => Some("Mar"),
        4 => Some("Apr"),
        5 => Some("May"),
        6 => Some("Jun"),
        7 => Some("Jul"),
        8 => Some("Aug"),
        9 => Some("Sep"),
        10 => Some("Oct"),
        11 => Some("Nov"),
        12 => Some("Dec"),
        _ => None,
    }
}

fn month_number(value: &str) -> Option<u32> {
    match value {
        "Jan" => Some(1),
        "Feb" => Some(2),
        "Mar" => Some(3),
        "Apr" => Some(4),
        "May" => Some(5),
        "Jun" => Some(6),
        "Jul" => Some(7),
        "Aug" => Some(8),
        "Sep" => Some(9),
        "Oct" => Some(10),
        "Nov" => Some(11),
        "Dec" => Some(12),
        _ => None,
    }
}

fn weekday_name(days_since_epoch: i64) -> Option<&'static str> {
    // 1970-01-01 was Thursday.
    let index = (days_since_epoch + 4).rem_euclid(7);
    match index {
        0 => Some("Sun"),
        1 => Some("Mon"),
        2 => Some("Tue"),
        3 => Some("Wed"),
        4 => Some("Thu"),
        5 => Some("Fri"),
        6 => Some("Sat"),
        _ => None,
    }
}

fn civil_from_days(days_since_epoch: i64) -> Option<(i32, u32, u32)> {
    let z = days_since_epoch.checked_add(719_468)?;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let month_prime = (5 * doy + 2) / 153;
    let day = doy - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    let year = i32::try_from(year).ok()?;
    let month = u32::try_from(month).ok()?;
    let day = u32::try_from(day).ok()?;
    Some((year, month, day))
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i64> {
    if !(1..=12).contains(&month) || day == 0 || day > 31 {
        return None;
    }

    let mut year = i64::from(year);
    if month <= 2 {
        year -= 1;
    }
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let month_prime = i64::from(month) + if month > 2 { -3 } else { 9 };
    let doy = (153 * month_prime + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
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
                let high = iter
                    .next()
                    .ok_or_else(|| "Incomplete percent encoding.".to_string())?;
                let low = iter
                    .next()
                    .ok_or_else(|| "Incomplete percent encoding.".to_string())?;
                let high_val =
                    hex_value(high).ok_or_else(|| "Invalid percent encoding.".to_string())?;
                let low_val =
                    hex_value(low).ok_or_else(|| "Invalid percent encoding.".to_string())?;
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
        "jpg" | "jpeg" | "jpe" | "jfif" => "image/jpeg",
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
