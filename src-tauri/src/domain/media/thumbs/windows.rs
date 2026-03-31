// Windows-specific shell thumbnail helpers.
use std::ffi::OsStr;
use std::iter::once;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows::core::PCWSTR;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, SelectObject, BITMAP,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
    SIIGBF_THUMBNAILONLY,
};

// Use the shell thumbnail provider to keep video previews lightweight.
pub(super) fn render_video_thumbnail(
    path: &Path,
    size: u32,
) -> Result<image::DynamicImage, String> {
    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(once(0)).collect();
    let factory: IShellItemImageFactory =
        unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None) }
            .map_err(|err| err.to_string())?;
    let hbitmap = unsafe {
        factory
            .GetImage(
                SIZE {
                    cx: size as i32,
                    cy: size as i32,
                },
                SIIGBF_BIGGERSIZEOK | SIIGBF_THUMBNAILONLY,
            )
            .map_err(|err| err.to_string())?
    };
    let image = hbitmap_to_image(hbitmap);
    unsafe {
        let _ = DeleteObject(HGDIOBJ(hbitmap.0));
    }
    image
}

fn hbitmap_to_image(bitmap: HBITMAP) -> Result<image::DynamicImage, String> {
    let mut bmp = BITMAP::default();
    let bmp_size = std::mem::size_of::<BITMAP>() as i32;
    let read = unsafe { GetObjectW(HGDIOBJ(bitmap.0), bmp_size, Some(&mut bmp as *mut _ as _)) };
    if read == 0 {
        return Err("Failed to read thumbnail bitmap".to_string());
    }

    let width = bmp.bmWidth;
    let height = bmp.bmHeight.abs();
    if width <= 0 || height <= 0 {
        return Err("Invalid thumbnail bitmap size".to_string());
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
        return Err("Failed to create thumbnail context".to_string());
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
        return Err("Failed to read thumbnail pixels".to_string());
    }

    for chunk in buffer.chunks_exact_mut(4) {
        let blue = chunk[0];
        chunk[0] = chunk[2];
        chunk[2] = blue;
    }

    let image = image::RgbaImage::from_raw(width as u32, height as u32, buffer)
        .ok_or_else(|| "Invalid thumbnail buffer".to_string())?;
    Ok(image::DynamicImage::ImageRgba8(image))
}
