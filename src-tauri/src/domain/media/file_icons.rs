// Retrieves and caches default app icons for file extensions.
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIconHit {
    pub extension: String,
    pub icon_path: String,
}

pub fn get_file_icons(app_handle: &AppHandle, extensions: Vec<String>) -> Result<Vec<FileIconHit>, String> {
    let cache_dir = resolve_cache_dir(app_handle);
    if let Err(err) = fs::create_dir_all(&cache_dir) {
        eprintln!("icon cache init failed: {err}");
    }

    let mut hits = Vec::new();
    let mut seen = HashSet::new();

    for extension in extensions {
        let normalized = normalize_extension(&extension);
        if normalized.is_empty() {
            continue;
        }
        if !seen.insert(normalized.clone()) {
            continue;
        }
        let icon_path = build_icon_path(&cache_dir, &normalized);
        if icon_path.exists() {
            hits.push(FileIconHit {
                extension: normalized,
                icon_path: icon_path.to_string_lossy().to_string(),
            });
            continue;
        }

        #[cfg(target_os = "windows")]
        {
            match render_extension_icon(&normalized) {
                Ok(image) => {
                    if let Some(parent) = icon_path.parent() {
                        if let Err(err) = fs::create_dir_all(parent) {
                            eprintln!("icon cache dir failed: {err}");
                            continue;
                        }
                    }
                    if let Err(err) = write_icon_file(&icon_path, image) {
                        eprintln!("icon cache write failed: {err}");
                        continue;
                    }
                    hits.push(FileIconHit {
                        extension: normalized,
                        icon_path: icon_path.to_string_lossy().to_string(),
                    });
                }
                Err(err) => {
                    eprintln!("icon render failed: {err}");
                }
            }
        }
    }

    Ok(hits)
}

fn normalize_extension(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.trim_start_matches('.').to_lowercase()
}

fn resolve_cache_dir(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("icons")
}

fn build_icon_path(cache_dir: &Path, extension: &str) -> PathBuf {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    extension.hash(&mut hasher);
    let hash = hasher.finish();
    let shard = format!("{:02x}", hash & 0xff);
    let file_name = format!("{:x}.png", hash);
    cache_dir.join(shard).join(&file_name)
}

#[cfg(target_os = "windows")]
fn write_icon_file(path: &Path, image: image::DynamicImage) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|err| err.to_string())?;
    let mut writer = std::io::BufWriter::new(file);
    image
        .write_to(&mut writer, image::ImageOutputFormat::Png)
        .map_err(|err| err.to_string())
}

#[cfg(target_os = "windows")]
fn render_extension_icon(extension: &str) -> Result<image::DynamicImage, String> {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, HICON};

    let name = format!("placeholder.{}", extension);
    let wide: Vec<u16> = OsStr::new(&name).encode_wide().chain(once(0)).collect();
    let mut info = SHFILEINFOW::default();
    let flags = SHGFI_ICON | SHGFI_USEFILEATTRIBUTES | SHGFI_LARGEICON;
    let result = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_ATTRIBUTE_NORMAL,
            Some(&mut info as *mut SHFILEINFOW),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        )
    };
    if result == 0 || info.hIcon.0.is_null() {
        return Err("Unable to resolve icon for extension".to_string());
    }
    let icon: HICON = info.hIcon;
    let image = hicon_to_image(icon);
    unsafe {
        let _ = DestroyIcon(icon);
    }
    image
}

#[cfg(target_os = "windows")]
fn hicon_to_image(
    icon: windows::Win32::UI::WindowsAndMessaging::HICON,
) -> Result<image::DynamicImage, String> {
    use windows::Win32::Graphics::Gdi::DeleteObject;
    use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

    let mut icon_info = ICONINFO::default();
    unsafe { GetIconInfo(icon, &mut icon_info).map_err(|err| err.to_string())? };
    let color_bitmap = icon_info.hbmColor;
    let mask_bitmap = icon_info.hbmMask;
    let image = if !color_bitmap.0.is_null() {
        hbitmap_to_image(color_bitmap)
    } else {
        Err("Icon bitmap missing color data".to_string())
    };

    unsafe {
        if !color_bitmap.0.is_null() {
            let _ = DeleteObject(windows::Win32::Graphics::Gdi::HGDIOBJ(color_bitmap.0));
        }
        if !mask_bitmap.0.is_null() {
            let _ = DeleteObject(windows::Win32::Graphics::Gdi::HGDIOBJ(mask_bitmap.0));
        }
    }

    image
}

#[cfg(target_os = "windows")]
fn hbitmap_to_image(
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
) -> Result<image::DynamicImage, String> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, GetDIBits, GetObjectW, SelectObject, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };

    let mut bmp = BITMAP::default();
    let bmp_size = std::mem::size_of::<BITMAP>() as i32;
    let read = unsafe { GetObjectW(HGDIOBJ(bitmap.0), bmp_size, Some(&mut bmp as *mut _ as _)) };
    if read == 0 {
        return Err("Failed to read icon bitmap".to_string());
    }

    let width = bmp.bmWidth;
    let height = bmp.bmHeight.abs();
    if width <= 0 || height <= 0 {
        return Err("Invalid icon bitmap size".to_string());
    }

    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width,
        biHeight: -height,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };

    let mut buffer = vec![0u8; width as usize * height as usize * 4];
    let hdc = unsafe { CreateCompatibleDC(None) };
    if hdc.is_invalid() {
        return Err("Failed to create icon context".to_string());
    }
    let old = unsafe { SelectObject(hdc, HGDIOBJ(bitmap.0)) };
    let scan_lines = unsafe {
        GetDIBits(
            hdc,
            bitmap,
            0,
            height as u32,
            Some(buffer.as_mut_ptr() as *mut _),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    unsafe {
        SelectObject(hdc, old);
        let _ = DeleteDC(hdc);
    }
    if scan_lines == 0 {
        return Err("Failed to read icon pixels".to_string());
    }

    for chunk in buffer.chunks_exact_mut(4) {
        let blue = chunk[0];
        chunk[0] = chunk[2];
        chunk[2] = blue;
    }

    let image = image::RgbaImage::from_raw(width as u32, height as u32, buffer)
        .ok_or_else(|| "Invalid icon buffer".to_string())?;
    Ok(image::DynamicImage::ImageRgba8(image))
}
