// Names that round-trip as individual Win32 path components.
pub(crate) fn plain_component(name: &str) -> bool {
    // Do not emit paths whose name Win32 may round-trip to a different entry.
    !name.is_empty()
        && !name.ends_with(['.', ' '])
        && !name.contains(['\\', '/', ':', '<', '>', '"', '|', '?', '*'])
        && !name.chars().any(|character| character <= '\u{1f}')
        && !dos_device_name(name)
}

fn dos_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().trim_end();
    let stem = stem.to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || stem
        .strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"))
        .is_some_and(|number| {
            matches!(
                number,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
}
