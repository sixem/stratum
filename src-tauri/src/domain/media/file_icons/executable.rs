// Read the file's first embedded icon without opening it as an application.
use std::collections::{hash_map::DefaultHasher, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use image::DynamicImage;
use windows::core::PCWSTR;
use windows::Win32::Foundation::S_OK;
use windows::Win32::UI::Shell::SHDefExtractIconW;
use windows::Win32::UI::WindowsAndMessaging::HICON;

use super::cache::{fresh_icon, publish_icon, trim_icon_cache};
use super::{owned_hicon_to_image, ExecutableIconHit};

const ICON_SIZE: u32 = 96;
const MAX_BATCH: usize = 32;
const MAX_CACHED_ICONS: usize = 1024;

type FileVersion = (u64, SystemTime);

pub(super) fn load_icons(cache_root: &Path, paths: Vec<String>) -> Vec<ExecutableIconHit> {
    let directory = cache_root.join("executables-v1");
    let mut seen = HashSet::new();
    let mut hits = Vec::new();
    let mut added_icons = false;
    for input in paths.into_iter().take(MAX_BATCH) {
        if !seen.insert(input.clone()) {
            continue;
        }
        let source = Path::new(&input);
        if let Some(target) = load_icon(&directory, source, &mut added_icons) {
            hits.push(ExecutableIconHit {
                path: input,
                icon_path: target.to_string_lossy().into_owned(),
            });
        }
    }
    if added_icons {
        trim_icon_cache(&directory, MAX_CACHED_ICONS);
        hits.retain(|hit| fresh_icon(Path::new(&hit.icon_path)));
    }
    hits
}

fn load_icon(directory: &Path, source: &Path, added_icons: &mut bool) -> Option<PathBuf> {
    if !source.is_absolute()
        || !source
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return None;
    }
    let version = file_version(source)?;
    let target = icon_path(directory, source, version);
    if fresh_icon(&target) {
        return Some(target);
    }
    let image = extract_icon(source)?;
    // A download or update can replace the executable while its icon is read.
    if file_version(source) != Some(version) {
        return None;
    }
    fs::create_dir_all(directory).ok()?;
    publish_icon(&target, &image).ok()?;
    *added_icons = true;
    Some(target)
}

fn file_version(path: &Path) -> Option<FileVersion> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    Some((meta.len(), meta.modified().ok()?))
}

fn icon_path(directory: &Path, source: &Path, version: FileVersion) -> PathBuf {
    let mut key = DefaultHasher::new();
    (source, version).hash(&mut key);
    directory.join(format!("{:016x}.png", key.finish()))
}

fn extract_icon(path: &Path) -> Option<DynamicImage> {
    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut icon = HICON::default();
    let status = unsafe {
        SHDefExtractIconW(
            PCWSTR(name.as_ptr()),
            0,
            0,
            Some(&mut icon),
            None,
            ICON_SIZE,
        )
    };
    if icon.is_invalid() {
        return None;
    }
    // The conversion owns the HICON and releases it on all paths.
    let image = owned_hicon_to_image(icon).ok()?;
    if status != S_OK || image.width().max(image.height()) > ICON_SIZE {
        return None;
    }
    let pixels = image.into_rgba8();
    pixels
        .pixels()
        .any(|pixel| pixel[3] != 0)
        .then_some(DynamicImage::ImageRgba8(pixels))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "stratum-executable-icons-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
            ));
            fs::create_dir(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn caches_distinct_executable_icons_and_updates_a_replaced_file() {
        let fixture = Fixture::new();
        let windows = PathBuf::from(std::env::var_os("SystemRoot").unwrap());
        let first = fixture.0.join("first.EXE");
        let second = fixture.0.join("second.exe");
        let invalid = fixture.0.join("incomplete.exe");
        fs::copy(windows.join("explorer.exe"), &first).unwrap();
        fs::copy(windows.join("System32").join("cmd.exe"), &second).unwrap();
        fs::write(&invalid, b"no icon resource").unwrap();

        let inputs = [&first, &second, &invalid].map(|path| path.to_string_lossy().into_owned());
        let hits = load_icons(&fixture.0, inputs.to_vec());
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].path, inputs[0]);
        assert_eq!(hits[1].path, inputs[1]);
        let pictures = hits
            .iter()
            .map(|hit| image::open(&hit.icon_path).unwrap().into_rgba8())
            .collect::<Vec<_>>();
        assert!(pictures
            .iter()
            .all(|icon| icon.dimensions() == (ICON_SIZE, ICON_SIZE)));
        assert_ne!(pictures[0], pictures[1]);
        let cached = load_icons(&fixture.0, inputs.to_vec());
        assert_eq!(cached[0].icon_path, hits[0].icon_path);

        // Update the bytes on disk while keeping the same filename.
        fs::OpenOptions::new()
            .append(true)
            .open(&first)
            .unwrap()
            .write_all(&[0])
            .unwrap();
        let updated = load_icons(&fixture.0, inputs.to_vec());
        assert_ne!(updated[0].icon_path, hits[0].icon_path);
        assert_eq!(updated[1].icon_path, hits[1].icon_path);
    }
}
