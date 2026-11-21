// Keep both native icon caches small and publish only complete PNGs.
use image::{DynamicImage, ImageOutputFormat};
use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::Path;
use std::time::Duration;

const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

pub(super) fn fresh_icon(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|info| {
        info.is_file()
            && info.len() > 0
            && info
                .modified()
                .is_ok_and(|modified| modified.elapsed().unwrap_or_default() < MAX_AGE)
    })
}

pub(super) fn publish_icon(path: &Path, image: &DynamicImage) -> io::Result<()> {
    let mut nonce = [0; 8];
    getrandom::fill(&mut nonce).map_err(|error| io::Error::other(error.to_string()))?;
    let stage = path.with_extension(format!("{:016x}.tmp", u64::from_le_bytes(nonce)));
    let file = File::options().write(true).create_new(true).open(&stage)?;
    let result = encode_icon(file, image).and_then(|()| fs::rename(&stage, path));
    if result.is_err() {
        let _ = fs::remove_file(stage);
        // Another background request may have already published this icon.
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

pub(super) fn trim_icon_cache(directory: &Path, max_icons: usize) {
    let Ok(entries) = fs::read_dir(directory) else {
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
    let excess = icons.len().saturating_sub(max_icons);
    if excess > 0 {
        icons.sort_unstable_by_key(|(modified, _)| *modified);
        for (_, path) in icons.into_iter().take(excess) {
            let _ = fs::remove_file(path);
        }
    }
}
