// Render only self-contained, size-bounded SVG thumbnails.
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};

use flate2::read::GzDecoder;
use image::{io::Reader as ImageReader, ImageFormat};
use resvg::tiny_skia::{Pixmap, PremultipliedColorU8, Transform};
use resvg::usvg::{self, roxmltree, ImageKind, TreeParsing};

const MAX_SVG_BYTES: u64 = 8 * 1024 * 1024;
const MAX_XML_NODES: u32 = 100_000;
const MAX_EMBEDDED_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_PIXELS: u64 = 4 * 1024 * 1024;

pub(super) fn render_svg_thumbnail(
    path: &Path,
    target_size: u32,
    dark_preview: bool,
) -> Result<image::DynamicImage, String> {
    let data = read_svg_data(File::open(path).map_err(|err| err.to_string())?)?;
    render_svg_data(&data, target_size, dark_preview)
}

fn render_svg_data(
    data: &[u8],
    target_size: u32,
    dark_preview: bool,
) -> Result<image::DynamicImage, String> {
    let mut tree = parse_svg_tree(data, dark_preview)?;

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
    let rgba = if dark_preview {
        dark_preview_pixels(pixmap)
    } else {
        pixmap.take()
    };
    let image = image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| "Invalid SVG render buffer".to_string())?;
    Ok(image::DynamicImage::ImageRgba8(image))
}

fn dark_preview_pixels(pixmap: Pixmap) -> Vec<u8> {
    let backed = needs_dark_preview_backdrop(pixmap.pixels());
    let mut rgba = pixmap.take();
    for pixel in rgba.chunks_exact_mut(4) {
        let alpha = u16::from(pixel[3]);
        if alpha == 255 {
            continue;
        }
        if backed {
            for (channel, background) in pixel[..3].iter_mut().zip([116u16, 116, 119]) {
                *channel = (u16::from(*channel) + (background * (255 - alpha) + 127) / 255) as u8;
            }
            pixel[3] = 255;
        } else if alpha != 0 {
            // tiny-skia uses premultiplied alpha. WebP needs straight RGBA.
            for channel in &mut pixel[..3] {
                *channel = ((u16::from(*channel) * 255 + alpha / 2) / alpha) as u8;
            }
        }
    }
    rgba
}

fn needs_dark_preview_backdrop(pixels: &[PremultipliedColorU8]) -> bool {
    static LINEAR_SRGB: OnceLock<[f32; 256]> = OnceLock::new();
    let linear = LINEAR_SRGB.get_or_init(|| {
        std::array::from_fn(|value| {
            let srgb = value as f32 / 255.0;
            if srgb <= 0.04045 {
                srgb / 12.92
            } else {
                ((srgb + 0.055) / 1.055).powf(2.4)
            }
        })
    });
    // A backdrop only helps when it can show through and most of the painted
    // area has less than 2:1 contrast against the dark card surface (#080808).
    let mut transparent = false;
    let mut paint = 0u64;
    let mut dark_paint = 0u64;
    for pixel in pixels {
        let alpha = pixel.alpha();
        transparent |= alpha < 255;
        if alpha == 0 {
            continue;
        }
        let color = pixel.demultiply();
        let luminance = 0.2126 * linear[usize::from(color.red())]
            + 0.7152 * linear[usize::from(color.green())]
            + 0.0722 * linear[usize::from(color.blue())];
        paint += u64::from(alpha);
        if luminance + 0.05 < 2.0 * (linear[8] + 0.05) {
            dark_paint += u64::from(alpha);
        }
    }
    transparent && paint > 0 && dark_paint * 4 >= paint * 3
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

fn parse_svg_tree(data: &[u8], dark_preview: bool) -> Result<usvg::Tree, String> {
    let text = std::str::from_utf8(data).map_err(|err| err.to_string())?;
    let themed_text;
    let mut document = parse_svg_document(text)?;
    let root = document.root_element();
    if dark_preview && text.contains("currentColor") && root.attribute("color").is_none() {
        // Add an inherited default at the validated root tag. Styles and explicit
        // fill/stroke colors still resolve through the normal SVG cascade.
        let name_start = root.range().start + 1;
        let name_end = text[name_start..]
            .find([' ', '\t', '\r', '\n', '/', '>'])
            .ok_or_else(|| "Invalid SVG root tag".to_string())?
            + name_start;
        themed_text = format!("{} color=\"#fff\"{}", &text[..name_end], &text[name_end..]);
        document = parse_svg_document(&themed_text)?;
    }
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

fn parse_svg_document(text: &str) -> Result<roxmltree::Document<'_>, String> {
    // Parse the bounded XML directly. This skips usvg's implicit gzip and DTD handling.
    roxmltree::Document::parse_with_options(
        text,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            nodes_limit: MAX_XML_NODES,
        },
    )
    .map_err(|err| err.to_string())
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
        assert!(parse_svg_tree(&read_svg_data(SIMPLE_SVG).unwrap(), false).is_ok());
        let mut gzip = GzEncoder::new(Vec::new(), Compression::fast());
        gzip.write_all(SIMPLE_SVG).unwrap();
        let gzip = gzip.finish().unwrap();
        assert!(parse_svg_tree(&read_svg_data(gzip.as_slice()).unwrap(), false).is_ok());
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
        let tree = parse_svg_tree(text, true).unwrap();
        assert!(tree.node_by_id("shape").is_some());
        assert!(tree.node_by_id("external").is_none());
    }

    #[test]
    fn dark_previews_use_white_current_color_and_keep_authored_colors() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="2">
            <rect width="2" height="2" fill="currentColor"/>
            <rect x="2" width="2" height="2" fill="black"/>
            <rect x="4" width="2" height="2" style="color: red; fill: currentColor"/>
        </svg>"#;
        let dark = render_svg_data(svg, 8, true).unwrap().to_rgba8();
        let normal = render_svg_data(svg, 8, false).unwrap().to_rgba8();
        assert_eq!(dark.get_pixel(0, 0).0, [255, 255, 255, 255]);
        assert_eq!(dark.get_pixel(2, 0).0, [0, 0, 0, 255]);
        assert_eq!(dark.get_pixel(4, 0).0, [255, 0, 0, 255]);
        assert_eq!(dark.get_pixel(6, 0).0, [0, 0, 0, 0]);
        assert_eq!(normal.get_pixel(0, 0).0, [0, 0, 0, 255]);
        assert_eq!(normal.get_pixel(6, 0).0, [0, 0, 0, 0]);
    }

    #[test]
    fn dark_preview_backs_dark_artwork_and_keeps_white_artwork_transparent() {
        let dark_svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="2">
            <rect width="2" height="2" fill="black"/>
        </svg>"#;
        let white_svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="2">
            <rect width="2" height="2" fill="currentColor" opacity="0.5"/>
        </svg>"#;
        let dark = render_svg_data(dark_svg, 8, true).unwrap().to_rgba8();
        let white = render_svg_data(white_svg, 8, true).unwrap().to_rgba8();
        assert_eq!(dark.get_pixel(0, 0).0, [0, 0, 0, 255]);
        assert_eq!(dark.get_pixel(6, 0).0, [116, 116, 119, 255]);
        assert_eq!(white.get_pixel(0, 0).0, [255, 255, 255, 128]);
        assert_eq!(white.get_pixel(6, 0).0, [0, 0, 0, 0]);
    }
}
