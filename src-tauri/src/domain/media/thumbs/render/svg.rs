// Render only self-contained, size-bounded SVG thumbnails.
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use flate2::read::GzDecoder;
use image::{io::Reader as ImageReader, ImageFormat};
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{self, roxmltree, ImageKind, TreeParsing};

const MAX_SVG_BYTES: u64 = 8 * 1024 * 1024;
const MAX_XML_NODES: u32 = 100_000;
const MAX_EMBEDDED_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_PIXELS: u64 = 4 * 1024 * 1024;

pub(super) fn render_svg_thumbnail(
    path: &Path,
    target_size: u32,
) -> Result<image::DynamicImage, String> {
    let data = read_svg_data(File::open(path).map_err(|err| err.to_string())?)?;
    let mut tree = parse_svg_tree(&data)?;

    tree.calculate_abs_transforms();
    tree.calculate_bounding_boxes();
    let size = tree.size.to_int_size();
    let (width, height) = fit_svg_size(size.width(), size.height(), target_size);
    let mut pixmap =
        Pixmap::new(width, height).ok_or_else(|| "Invalid SVG render size".to_string())?;
    // Scale the vector tree before rasterizing it into the thumbnail buffer.
    let transform = Transform::from_scale(
        width as f32 / size.width() as f32,
        height as f32 / size.height() as f32,
    );
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    let image = image::RgbaImage::from_raw(width, height, pixmap.take())
        .ok_or_else(|| "Invalid SVG render buffer".to_string())?;
    Ok(image::DynamicImage::ImageRgba8(image))
}

fn read_svg_data(source: impl Read) -> Result<Vec<u8>, String> {
    let data = read_svg_bytes(source)?;
    // Match gzip by signature so compressed content is bounded under either extension.
    if data.starts_with(&[0x1f, 0x8b]) {
        return read_svg_bytes(GzDecoder::new(data.as_slice()));
    }
    Ok(data)
}

fn read_svg_bytes(source: impl Read) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    source
        .take(MAX_SVG_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|err| err.to_string())?;
    if data.len() as u64 > MAX_SVG_BYTES {
        return Err("SVG thumbnail source exceeds 8 MiB".to_string());
    }
    Ok(data)
}

fn parse_svg_tree(data: &[u8]) -> Result<usvg::Tree, String> {
    let text = std::str::from_utf8(data).map_err(|err| err.to_string())?;
    // Parse the bounded XML directly. This skips usvg's implicit gzip and DTD handling.
    let document = roxmltree::Document::parse_with_options(
        text,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: MAX_XML_NODES,
        },
    )
    .map_err(|err| err.to_string())?;
    let remaining_image_bytes = AtomicUsize::new(MAX_EMBEDDED_IMAGE_BYTES);
    let options = usvg::Options {
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_string: Box::new(|_, _| None),
            resolve_data: Box::new(move |mime, data, _| {
                // SVG references can repeat embedded data in the converted tree.
                remaining_image_bytes
                    .try_update(Ordering::Relaxed, Ordering::Relaxed, |remaining| {
                        remaining.checked_sub(data.len())
                    })
                    .ok()?;
                resolve_embedded_image(mime, data)
            }),
        },
        ..Default::default()
    };
    usvg::Tree::from_xmltree(&document, &options).map_err(|err| err.to_string())
}

fn resolve_embedded_image(mime: &str, data: Arc<Vec<u8>>) -> Option<ImageKind> {
    // Keep ordinary embedded raster images. SVG data URLs could invoke a separate
    // SVG parser or gzip decoder and bypass the outer document's limits.
    let actual = image::guess_format(data.as_slice()).ok()?;
    let declared = match mime {
        "image/jpg" | "image/jpeg" => ImageFormat::Jpeg,
        "image/png" => ImageFormat::Png,
        "image/gif" => ImageFormat::Gif,
        "text/plain"
            if matches!(
                actual,
                ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::Gif
            ) =>
        {
            actual
        }
        _ => return None,
    };
    if actual != declared {
        return None;
    }

    let (width, height) = ImageReader::with_format(Cursor::new(data.as_slice()), actual)
        .into_dimensions()
        .ok()?;
    if u64::from(width) * u64::from(height) > MAX_EMBEDDED_IMAGE_PIXELS {
        return None;
    }
    match actual {
        ImageFormat::Jpeg => Some(ImageKind::JPEG(data)),
        ImageFormat::Png => Some(ImageKind::PNG(data)),
        ImageFormat::Gif => Some(ImageKind::GIF(data)),
        _ => None,
    }
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

#[cfg(test)]
mod tests {
    use std::io::{self, Write};

    use flate2::{write::GzEncoder, Compression};

    use super::*;

    const SIMPLE_SVG: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>"#;

    #[test]
    fn accepts_plain_and_gzip_svg_within_the_budget() {
        assert!(parse_svg_tree(&read_svg_data(SIMPLE_SVG).unwrap()).is_ok());
        let mut gzip = GzEncoder::new(Vec::new(), Compression::fast());
        gzip.write_all(SIMPLE_SVG).unwrap();
        let gzip = gzip.finish().unwrap();
        assert!(parse_svg_tree(&read_svg_data(gzip.as_slice()).unwrap()).is_ok());
    }

    #[test]
    fn enforces_svg_input_and_output_limits() {
        let source = || io::repeat(b' ').take(MAX_SVG_BYTES + 1);
        assert!(read_svg_data(source()).is_err());
        let mut gzip = GzEncoder::new(Vec::new(), Compression::fast());
        io::copy(&mut source(), &mut gzip).unwrap();
        let gzip = gzip.finish().unwrap();
        assert!(read_svg_data(gzip.as_slice()).is_err());
    }

    #[test]
    fn accepts_small_embedded_raster_images_but_not_nested_svg() {
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(1, 1)
            .write_to(&mut png, image::ImageOutputFormat::Png)
            .unwrap();
        assert!(resolve_embedded_image("image/png", Arc::new(png.into_inner())).is_some());
        assert!(resolve_embedded_image("image/svg+xml", Arc::new(SIMPLE_SVG.to_vec())).is_none());
    }

    #[test]
    fn svg_uses_its_own_vector_shapes_and_omits_external_images() {
        let text = br#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">
            <rect id="shape" width="8" height="8"/>
            <image id="external" href="adjacent.png" width="8" height="8"/>
        </svg>"#;
        let tree = parse_svg_tree(text).unwrap();
        assert!(tree.node_by_id("shape").is_some());
        assert!(tree.node_by_id("external").is_none());
    }
}
