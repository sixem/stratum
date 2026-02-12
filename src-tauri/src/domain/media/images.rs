// Image metadata + conversion helpers for future UI features.
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufWriter;
use std::path::Path;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub format: Option<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageTargetFormat {
    Jpeg,
    Png,
    Webp,
    Bmp,
    Gif,
    Tiff,
    Ico,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageConvertOptions {
    pub format: ImageTargetFormat,
    pub quality: Option<u8>,
    pub overwrite: Option<bool>,
}

pub fn get_image_info(path: String) -> Result<ImageInfo, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Empty path".to_string());
    }
    let source = Path::new(trimmed);
    if !source.exists() {
        return Err("File does not exist".to_string());
    }
    if source.is_dir() {
        return Err("Path is a folder".to_string());
    }

    let reader = image::io::Reader::open(source).map_err(|err| err.to_string())?;
    let reader = reader
        .with_guessed_format()
        .map_err(|err| err.to_string())?;
    let format = reader.format().map(format_label);
    let (width, height) = reader.into_dimensions().map_err(|err| err.to_string())?;

    Ok(ImageInfo {
        path: trimmed.to_string(),
        width,
        height,
        format,
    })
}

pub fn convert_image(
    path: String,
    destination: String,
    options: ImageConvertOptions,
) -> Result<(), String> {
    let source_path = path.trim();
    let destination_path = destination.trim();
    if source_path.is_empty() {
        return Err("Empty source path".to_string());
    }
    if destination_path.is_empty() {
        return Err("Empty destination path".to_string());
    }

    let source = Path::new(source_path);
    if !source.exists() {
        return Err("Source does not exist".to_string());
    }
    if source.is_dir() {
        return Err("Source is a folder".to_string());
    }

    let target = Path::new(destination_path);
    let overwrite = options.overwrite.unwrap_or(false);
    if target.exists() && !overwrite {
        return Err("Destination already exists".to_string());
    }
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }

    let image = image::open(source).map_err(|err| err.to_string())?;
    let output = match options.format {
        ImageTargetFormat::Jpeg => {
            let quality = options.quality.unwrap_or(82).min(100);
            image::ImageOutputFormat::Jpeg(quality)
        }
        ImageTargetFormat::Png => image::ImageOutputFormat::Png,
        ImageTargetFormat::Webp => image::ImageOutputFormat::WebP,
        ImageTargetFormat::Bmp => image::ImageOutputFormat::Bmp,
        ImageTargetFormat::Gif => image::ImageOutputFormat::Gif,
        ImageTargetFormat::Tiff => image::ImageOutputFormat::Tiff,
        ImageTargetFormat::Ico => image::ImageOutputFormat::Ico,
    };

    let file = if overwrite {
        fs::File::create(target).map_err(|err| err.to_string())?
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|err| err.to_string())?
    };
    let mut writer = BufWriter::new(file);
    image
        .write_to(&mut writer, output)
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn format_label(format: image::ImageFormat) -> String {
    match format {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpeg",
        image::ImageFormat::WebP => "webp",
        image::ImageFormat::Bmp => "bmp",
        image::ImageFormat::Gif => "gif",
        image::ImageFormat::Tiff => "tiff",
        image::ImageFormat::Ico => "ico",
        _ => "unknown",
    }
    .to_string()
}
