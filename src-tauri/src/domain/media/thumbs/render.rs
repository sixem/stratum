// Rendering helpers for each thumbnail source kind.
use std::fs;
use std::io::{self, BufWriter, Write};
use std::path::Path;

use image::io::Reader as ImageReader;

use super::{cache, ThumbFormat, ThumbJob, ThumbKind, ThumbRenderOutput, MAX_THUMB_SIZE};

mod svg;

pub(super) fn render_thumbnail(job: &ThumbJob) -> Result<ThumbRenderOutput, String> {
    if cache::has_thumbnail(&job.thumb_path) {
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
    let format = match job.options.format_for(job.kind) {
        ThumbFormat::Webp => image::ImageOutputFormat::WebP,
        ThumbFormat::Jpeg => image::ImageOutputFormat::Jpeg(job.options.quality),
    };
    let added_bytes = publish_thumbnail(&job.thumb_path, |file| {
        resized.write_to(file, format).map_err(io::Error::other)
    })
    .map_err(|err| err.to_string())?;
    Ok(ThumbRenderOutput {
        path: job.thumb_path.clone(),
        added_bytes,
    })
}

pub(super) fn publish_thumbnail(
    path: &Path,
    encode: impl FnOnce(&mut BufWriter<fs::File>) -> io::Result<()>,
) -> io::Result<u64> {
    // Publish only a completed image, so a partial write cannot become a cache hit.
    let mut nonce = [0; 8];
    getrandom::fill(&mut nonce).map_err(|error| io::Error::other(error.to_string()))?;
    let stage = path.with_extension(format!("{:016x}.tmp", u64::from_le_bytes(nonce)));
    let file = fs::File::options()
        .write(true)
        .create_new(true)
        .open(&stage)?;
    let mut writer = BufWriter::new(file);
    let result = encode(&mut writer)
        .and_then(|()| writer.flush())
        .and_then(|()| writer.get_ref().metadata())
        .map(|metadata| metadata.len());
    drop(writer);
    let result = result.and_then(|size| fs::rename(&stage, path).map(|()| size));
    if result.is_err() {
        let _ = fs::remove_file(stage);
    }
    result
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
        ThumbKind::Svg => {
            svg::render_svg_thumbnail(&job.path, target_size, job.options.dark_svg_previews)
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory() -> std::path::PathBuf {
        let mut nonce = [0; 8];
        getrandom::fill(&mut nonce).unwrap();
        let dir = std::env::temp_dir().join(format!(
            "stratum-thumbnail-write-{:016x}",
            u64::from_le_bytes(nonce)
        ));
        fs::create_dir(&dir).unwrap();
        dir
    }

    #[test]
    fn failed_thumbnail_encoding_leaves_no_cache_file() {
        let dir = test_directory();
        let target = dir.join("test.webp");

        let failed = publish_thumbnail(&target, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("encoding failed"))
        });
        let count_after_failure = fs::read_dir(&dir).unwrap().count();
        let succeeded = publish_thumbnail(&target, |file| file.write_all(b"complete"));
        let contents = fs::read(&target);
        fs::remove_dir_all(dir).unwrap();

        assert_eq!(failed.unwrap_err().to_string(), "encoding failed");
        assert_eq!(count_after_failure, 0);
        assert_eq!(succeeded.unwrap(), 8);
        assert_eq!(contents.unwrap(), b"complete");
    }

    #[test]
    fn deleted_cached_thumbnail_is_regenerated_on_request() {
        let dir = test_directory();
        let source = dir.join("source.png");
        image::RgbImage::from_pixel(5, 5, image::Rgb([11, 23, 37]))
            .save(&source)
            .unwrap();
        let job = ThumbJob {
            id: "generated.webp".into(),
            path: source,
            thumb_path: dir.join("cache").join("generated.webp"),
            key: String::new(),
            signature: String::new(),
            options: super::super::ThumbOptions {
                size: 4,
                quality: 80,
                format: ThumbFormat::Webp,
                allow_videos: false,
                allow_svgs: false,
                dark_svg_previews: false,
                cache_mb: 32,
            },
            kind: ThumbKind::Image,
        };
        assert!(render_thumbnail(&job).unwrap().added_bytes > 0);
        assert!(cache::has_thumbnail(&job.thumb_path));
        assert_eq!(render_thumbnail(&job).unwrap().added_bytes, 0);

        fs::remove_file(&job.thumb_path).unwrap();
        assert!(!cache::has_thumbnail(&job.thumb_path));
        assert!(render_thumbnail(&job).unwrap().added_bytes > 0);
        assert!(cache::has_thumbnail(&job.thumb_path));
        fs::remove_dir_all(&dir).unwrap();
    }
}
