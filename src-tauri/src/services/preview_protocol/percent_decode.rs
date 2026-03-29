// Percent-decoding helpers for preview protocol paths.
// Paths are decoded separately so the main service can stay focused on request flow.

pub fn decode_path(raw_path: &str) -> Result<String, String> {
    let trimmed = raw_path.trim_start_matches('/');
    if trimmed.is_empty() {
        return Err("Missing path.".to_string());
    }

    // Decode the percent-escaped path so Windows paths round-trip correctly.
    decode_component(trimmed)
}

fn decode_component(value: &str) -> Result<String, String> {
    let mut bytes = Vec::with_capacity(value.len());
    let mut iter = value.as_bytes().iter().copied();
    while let Some(byte) = iter.next() {
        match byte {
            b'%' => {
                let high = iter
                    .next()
                    .ok_or_else(|| "Incomplete percent encoding.".to_string())?;
                let low = iter
                    .next()
                    .ok_or_else(|| "Incomplete percent encoding.".to_string())?;
                let high_val =
                    hex_value(high).ok_or_else(|| "Invalid percent encoding.".to_string())?;
                let low_val =
                    hex_value(low).ok_or_else(|| "Invalid percent encoding.".to_string())?;
                bytes.push((high_val << 4) | low_val);
            }
            // Unlike query strings, URL paths do not treat '+' as a space.
            _ => bytes.push(byte),
        }
    }
    String::from_utf8(bytes).map_err(|_| "Invalid UTF-8 in path.".to_string())
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
