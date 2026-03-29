// Content-type lookup for previewable media extensions.

use std::path::Path;

pub fn content_type_for_path(path: &Path) -> &'static str {
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
