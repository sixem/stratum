// Persistent small Shell icons for app associations, independent of file extension.
use std::collections::hash_map::DefaultHasher;
use std::ffi::OsString;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{self, BufReader, BufWriter, Write};
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use image::{
    imageops::FilterType, io::Limits, io::Reader, DynamicImage, ImageFormat, ImageOutputFormat,
};
use windows::core::HSTRING;
use windows::Win32::UI::{
    Controls::{IImageList, ILD_TRANSPARENT},
    Shell::{SHGetImageList, SHLoadIndirectString, Shell_GetCachedImageIndexW, SHIL_SMALL},
};

const MAX_ICON_SIDE: u32 = 32;
const MAX_ICONS: usize = 256;
const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

pub(crate) struct HandlerIconCache {
    directory: PathBuf,
    small_icons: Option<IImageList>,
    added_icons: bool,
}

impl HandlerIconCache {
    pub(crate) fn new(app_local_data: &Path) -> Self {
        Self {
            directory: app_local_data.join("icons").join("open-with-v1"),
            small_icons: None,
            added_icons: false,
        }
    }

    pub(crate) fn get(&mut self, location: &str, resource_index: i32) -> Option<String> {
        if location.is_empty() {
            return None;
        }

        // The resource path and index identify the same icon across file types.
        let mut key = DefaultHasher::new();
        (location, resource_index).hash(&mut key);
        let path = self.directory.join(format!("{:016x}.png", key.finish()));
        if !fresh_icon(&path) {
            let icon = self.extract(location, resource_index)?;
            fs::create_dir_all(&self.directory).ok()?;
            publish_icon(&path, &icon).ok()?;
            self.added_icons = true;
        }
        Some(path.to_string_lossy().into_owned())
    }

    fn extract(&mut self, location: &str, resource_index: i32) -> Option<DynamicImage> {
        let image = if location.starts_with("@{") {
            packaged_app_icon(location)
        } else {
            self.desktop_app_icon(location, resource_index)
        }?;
        let rgba = image.into_rgba8();
        if !rgba.pixels().any(|pixel| pixel.0[3] != 0) {
            return None;
        }
        let image = DynamicImage::ImageRgba8(rgba);
        if image.width().max(image.height()) > MAX_ICON_SIDE {
            return Some(image.resize(MAX_ICON_SIDE, MAX_ICON_SIDE, FilterType::Triangle));
        }
        Some(image)
    }

    fn desktop_app_icon(&mut self, location: &str, resource_index: i32) -> Option<DynamicImage> {
        let index =
            unsafe { Shell_GetCachedImageIndexW(&HSTRING::from(location), resource_index, 0) };
        if index < 0 {
            return None;
        }
        if self.small_icons.is_none() {
            self.small_icons = unsafe { SHGetImageList(SHIL_SMALL as i32) }.ok();
        }
        let icon = unsafe { self.small_icons.as_ref()?.GetIcon(index, ILD_TRANSPARENT.0) }.ok()?;
        if icon.is_invalid() {
            return None;
        }
        super::owned_hicon_to_image(icon).ok()
    }

    pub(crate) fn trim(&self) {
        // Cache hits need only one stat. Scan the small directory once after a batch of writes.
        if !self.added_icons {
            return;
        }
        let Ok(entries) = fs::read_dir(&self.directory) else {
            return;
        };
        let mut icons = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
                continue;
            };
            if !matches!(extension, "png" | "tmp")
                || !entry.file_type().is_ok_and(|kind| kind.is_file())
            {
                continue;
            }
            let Ok(modified) = entry.metadata().and_then(|item| item.modified()) else {
                continue;
            };
            if modified.elapsed().unwrap_or_default() >= MAX_AGE {
                let _ = fs::remove_file(path);
            } else if extension == "png" {
                icons.push((modified, path));
            }
        }
        let excess = icons.len().saturating_sub(MAX_ICONS);
        if excess > 0 {
            icons.sort_unstable_by_key(|(modified, _)| *modified);
            for (_, path) in icons.into_iter().take(excess) {
                let _ = fs::remove_file(path);
            }
        }
    }
}

fn packaged_app_icon(location: &str) -> Option<DynamicImage> {
    // Resolve a package resource using the Shell's current resource context.
    let mut path = [0u16; 1024];
    unsafe { SHLoadIndirectString(&HSTRING::from(location), &mut path, None) }.ok()?;
    let end = path.iter().position(|&unit| unit == 0)?;
    let path = PathBuf::from(OsString::from_wide(&path[..end]));
    if !path.is_absolute() {
        return None;
    }
    let file = File::open(path).ok()?;
    let mut reader = Reader::with_format(BufReader::new(file), ImageFormat::Png);
    let mut limits = Limits::default();
    limits.max_image_width = Some(512);
    limits.max_image_height = Some(512);
    limits.max_alloc = Some(4 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().ok()
}

fn fresh_icon(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|info| {
        info.is_file()
            && info.len() > 0
            && info
                .modified()
                .is_ok_and(|modified| modified.elapsed().unwrap_or_default() < MAX_AGE)
    })
}

fn publish_icon(path: &Path, image: &DynamicImage) -> io::Result<()> {
    // Use a private staging file so parallel menu requests never read a partial PNG.
    let mut nonce = [0; 8];
    getrandom::fill(&mut nonce).map_err(|error| io::Error::other(error.to_string()))?;
    let stage = path.with_extension(format!("{:016x}.tmp", u64::from_le_bytes(nonce)));
    let file = File::options().write(true).create_new(true).open(&stage)?;
    let result = encode_icon(file, image).and_then(|()| fs::rename(&stage, path));
    if result.is_err() {
        let _ = fs::remove_file(stage);
        // A concurrent render may have already published the same icon.
        if fresh_icon(path) {
            return Ok(());
        }
    }
    result
}

fn encode_icon(file: File, image: &DynamicImage) -> io::Result<()> {
    let mut writer = BufWriter::new(file);
    image
        .write_to(&mut writer, ImageOutputFormat::Png)
        .map_err(io::Error::other)?;
    writer.flush()
}
