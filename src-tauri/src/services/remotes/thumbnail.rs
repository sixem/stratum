// Never pass remote image bytes directly to the webview. Bound the input,
// decoded dimensions and output, then re-encode only a small raster preview.
use super::wire::{Fields, Reply, Request, Result, Wire};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    io::{Limits, Reader},
    ImageFormat,
};
use std::io::Cursor;

const MAX_INPUT: u64 = 1024 * 1024;
pub(super) fn supported(path: &str) -> bool {
    path.rsplit_once('.').is_some_and(|(_, extension)| {
        ["jpg", "jpeg", "png", "webp"]
            .iter()
            .any(|v| extension.eq_ignore_ascii_case(v))
    })
}
pub(super) async fn identity(wire: &mut Wire, host: &str, path: &str) -> Result<Option<String>> {
    if !supported(path) {
        return Ok(None);
    }
    let packet = wire
        .path_request(Request::Lstat, path.as_bytes(), Reply::Attrs)
        .await?;
    let attrs = Fields(&packet).attrs()?;
    match (attrs.kind(), attrs.size, attrs.modified) {
        (0o100000, Some(size @ 1..=MAX_INPUT), Some(modified)) => {
            Ok(Some(format!("v1\0{host}\0{path}\0{size}\0{modified}")))
        }
        _ => Ok(None),
    }
}
pub(super) async fn read(wire: &mut Wire, path: &str) -> Result<Option<Vec<u8>>> {
    if !supported(path) {
        return Ok(None);
    }
    let packet = wire
        .path_request(Request::Lstat, path.as_bytes(), Reply::Attrs)
        .await?;
    let attrs = Fields(&packet).attrs()?;
    if attrs.kind() != 0o100000 || !matches!(attrs.size, Some(1..=MAX_INPUT)) {
        return Ok(None);
    }
    let result = super::file::read_range(wire, path, 0, MAX_INPUT as usize).await?;
    if result.modified != attrs.modified || Some(result.size) != attrs.size {
        return Ok(None);
    }
    if result.size == 0 || result.size > MAX_INPUT || result.bytes.len() as u64 != result.size {
        return Ok(None);
    }
    Ok(Some(result.bytes))
}
pub(super) fn decode(bytes: Vec<u8>) -> Option<String> {
    let format = image::guess_format(&bytes).ok()?;
    if !matches!(
        format,
        ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP
    ) {
        return None;
    }
    // image 0.24's WebP decoder eagerly decodes during dimension probing.
    // Inspect headers before constructing any decoder. Extended WebP may have
    // multiple frames with dimensions independent of the outer canvas.
    if format == ImageFormat::WebP && !matches!(bytes.get(12..16), Some(b"VP8 " | b"VP8L")) {
        return None;
    }
    let size = imagesize::blob_size(&bytes).ok()?;
    let (w, h) = (size.width, size.height);
    if w == 0 || h == 0 || w > 4096 || h > 4096 || w * h > 8_000_000 {
        return None;
    }
    let mut reader = Reader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    let img = reader.decode().ok()?.thumbnail(128, 128);
    let mut result = Cursor::new(Vec::new());
    img.write_to(&mut result, ImageFormat::WebP).ok()?;
    Some(format!(
        "data:image/webp;base64,{}",
        STANDARD.encode(result.into_inner())
    ))
}
