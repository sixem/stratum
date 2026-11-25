// Content-type lookup for previewable media extensions.

use std::path::Path;

pub fn content_type_for_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();

    Some(match ext.as_str() {
        "jpg" | "jpeg" | "jpe" | "jfif" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "ico" => "image/x-icon",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "wmv" => "video/x-ms-wmv",
        "mpeg" | "mpg" | "mpe" => "video/mpeg",
        "flv" => "video/x-flv",
        "3gp" => "video/3gpp",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "m4a" => "audio/mp4",
        "ogg" | "oga" | "opus" => "audio/ogg",
        // Keep active document formats, including raw SVG, off the preview origin.
        _ => return None,
    })
}
