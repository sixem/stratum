// List the installed font families whose regular face has a fixed cell width.
use windows::core::{w, Error, Interface, BOOL};
use windows::Win32::Foundation::E_FAIL;
use windows::Win32::Graphics::DirectWrite::{
    DWriteCreateFactory, IDWriteFactory, IDWriteFont1, IDWriteFontFamily,
    DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL,
    DWRITE_FONT_WEIGHT_NORMAL,
};

fn family_name(family: &IDWriteFontFamily) -> windows::core::Result<String> {
    // Prefer the same family name across Windows display languages when available.
    unsafe {
        let names = family.GetFamilyNames()?;
        let mut index = 0;
        let mut found = BOOL::default();
        names.FindLocaleName(w!("en-us"), &mut index, &mut found)?;
        let index = if found.as_bool() { index } else { 0 };
        let length = names.GetStringLength(index)? as usize;
        let mut name = vec![0; length + 1];
        names.GetString(index, &mut name)?;
        Ok(String::from_utf16_lossy(&name[..length]))
    }
}

fn installed_monospace_families() -> windows::core::Result<Vec<String>> {
    let factory: IDWriteFactory = unsafe { DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)? };
    let mut collection = None;
    // Recheck when the picker opens so recently installed or removed fonts are reflected.
    unsafe { factory.GetSystemFontCollection(&mut collection, true)? };
    let collection = collection.ok_or_else(|| Error::from_hresult(E_FAIL))?;

    let mut families = Vec::new();
    for index in 0..unsafe { collection.GetFontFamilyCount() } {
        let Ok(family) = (unsafe { collection.GetFontFamily(index) }) else {
            continue;
        };
        let matching_font = unsafe {
            family.GetFirstMatchingFont(
                DWRITE_FONT_WEIGHT_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                DWRITE_FONT_STYLE_NORMAL,
            )
        };
        let Ok(font) = matching_font.and_then(|font| font.cast::<IDWriteFont1>()) else {
            continue;
        };
        if unsafe { font.IsMonospacedFont().as_bool() } {
            if let Ok(name) = family_name(&family) {
                families.push(name);
            }
        }
    }
    families.sort_unstable();
    families.dedup();
    Ok(families)
}

#[tauri::command]
pub(crate) async fn list_terminal_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(installed_monospace_families)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}
