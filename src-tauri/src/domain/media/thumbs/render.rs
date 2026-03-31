// Rendering helpers for each thumbnail source kind.
use std::fs;
use std::io::Read;
use std::path::Path;

use image::io::Reader as ImageReader;
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{self, TreeParsing};

use super::{ThumbFormat, ThumbJob, ThumbKind, ThumbRenderOutput, MAX_THUMB_SIZE};

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
    let image = load_source_image(job, target_size)?;
    let resized = image.thumbnail(target_size, target_size);
    let mut file = fs::File::create(&job.thumb_path).map_err(|err| err.to_string())?;
    match job.options.format {
        ThumbFormat::Webp => resized
            .write_to(&mut file, image::ImageOutputFormat::WebP)
            .map_err(|err| err.to_string())?,
        ThumbFormat::Jpeg => resized
            .write_to(&mut file, image::ImageOutputFormat::Jpeg(job.options.quality))
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
        ThumbKind::Svg => render_svg_thumbnail(&job.path, target_size),
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

// Rasterize SVGs into bitmap previews so they are safe to display.
fn render_svg_thumbnail(path: &Path, target_size: u32) -> Result<image::DynamicImage, String> {
    let data = read_svg_data(path)?;
    let mut options = usvg::Options::default();
    options.resources_dir = path.parent().map(|parent| parent.to_path_buf());
    let mut tree = usvg::Tree::from_data(&data, &options).map_err(|err| err.to_string())?;
    // Resolve transforms and bounds so resvg renders the SVG correctly.
    tree.calculate_abs_transforms();
    tree.calculate_bounding_boxes();
    let size = tree.size.to_int_size();
    let (width, height) = fit_svg_size(size.width(), size.height(), target_size);
    let mut pixmap =
        Pixmap::new(width, height).ok_or_else(|| "Invalid SVG render size".to_string())?;
    // resvg renders at the tree's intrinsic size, so we scale to the thumbnail size.
    let transform = Transform::from_scale(
        width as f32 / size.width() as f32,
        height as f32 / size.height() as f32,
    );
    let mut pixmap_mut = pixmap.as_mut();
    resvg::render(&tree, transform, &mut pixmap_mut);
    let image = image::RgbaImage::from_raw(width, height, pixmap.take())
        .ok_or_else(|| "Invalid SVG render buffer".to_string())?;
    Ok(image::DynamicImage::ImageRgba8(image))
}

// Handle both plain SVG and gzipped SVGZ sources.
fn read_svg_data(path: &Path) -> Result<Vec<u8>, String> {
    let raw = fs::read(path).map_err(|err| err.to_string())?;
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "svgz" {
        return Ok(raw);
    }
    let mut decoder = flate2::read::GzDecoder::new(raw.as_slice());
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|err| err.to_string())?;
    Ok(decompressed)
}

fn fit_svg_size(width: u32, height: u32, max_size: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (max_size.max(1), max_size.max(1));
    }
    let max_edge = width.max(height) as f32;
    let scale = (max_size.max(1) as f32) / max_edge;
    let target_width = (width as f32 * scale).round().max(1.0) as u32;
    let target_height = (height as f32 * scale).round().max(1.0) as u32;
    (target_width, target_height)
}
