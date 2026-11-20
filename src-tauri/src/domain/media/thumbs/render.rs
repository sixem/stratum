// Rendering helpers for each thumbnail source kind.
use std::fs;
use std::path::Path;

use image::io::Reader as ImageReader;

use super::{ThumbFormat, ThumbJob, ThumbKind, ThumbRenderOutput, MAX_THUMB_SIZE};

mod svg;

pub(super) fn render_thumbnail(job: &ThumbJob) -> Result<ThumbRenderOutput, String> {
    if job.thumb_path.exists() {
        return Ok(ThumbRenderOutput {
            path: job.thumb_path.clone(),
            added_bytes: 0,
        });
    }
    let parent = job
        .thumb_path
        .parent()
        .ok_or_else(|| "invalid thumbnail path".to_string())?;
    fs::create_dir_all(parent).map_err(|err| err.to_string())?;

    let target_size = clamp_thumb_size(job.options.size);
    // Release the full decoded image before encoding the small thumbnail.
    let resized = load_source_image(job, target_size)?.thumbnail(target_size, target_size);
    let mut file = fs::File::create(&job.thumb_path).map_err(|err| err.to_string())?;
    match job.options.format {
        ThumbFormat::Webp => resized
            .write_to(&mut file, image::ImageOutputFormat::WebP)
            .map_err(|err| err.to_string())?,
        ThumbFormat::Jpeg => resized
            .write_to(
                &mut file,
                image::ImageOutputFormat::Jpeg(job.options.quality),
            )
            .map_err(|err| err.to_string())?,
    }
    let added_bytes = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    Ok(ThumbRenderOutput {
        path: job.thumb_path.clone(),
        added_bytes,
    })
}

fn clamp_thumb_size(size: u32) -> u32 {
    size.max(1).min(MAX_THUMB_SIZE)
}

fn load_source_image(job: &ThumbJob, target_size: u32) -> Result<image::DynamicImage, String> {
    match job.kind {
        // Decode by inspecting file bytes so JPEG variants like `.jfif` work even when
        // the extension is not part of the image crate's default extension table.
        ThumbKind::Image => ImageReader::open(&job.path)
            .map_err(|err| err.to_string())?
            .with_guessed_format()
            .map_err(|err| err.to_string())?
            .decode()
            .map_err(|err| err.to_string()),
        ThumbKind::Video => render_video_thumbnail(&job.path, target_size),
        ThumbKind::Svg => svg::render_svg_thumbnail(&job.path, target_size),
    }
}

#[cfg(target_os = "windows")]
fn render_video_thumbnail(path: &Path, size: u32) -> Result<image::DynamicImage, String> {
    super::windows::render_video_thumbnail(path, size)
}

#[cfg(not(target_os = "windows"))]
fn render_video_thumbnail(_path: &Path, _size: u32) -> Result<image::DynamicImage, String> {
    Err("Video thumbnails are not supported on this platform".to_string())
}
