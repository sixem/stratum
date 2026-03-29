// Range-request parsing for preview media streaming.
// Isolating this keeps multipart/range edge cases out of the main request handler.

const MAX_RANGE_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

impl ByteRange {
    pub fn len(self) -> u64 {
        self.end.saturating_sub(self.start).saturating_add(1)
    }
}

pub fn parse_range_header(header_value: &str, size: u64) -> Result<Option<ByteRange>, ()> {
    if size == 0 {
        return Ok(None);
    }

    let range_set = header_value.trim();
    let range_set = match range_set.strip_prefix("bytes=") {
        Some(value) => value,
        None => return Err(()),
    };

    // Browsers may send multiple ranges (comma-separated). Our preview use-case only needs
    // the first range, and serving a multipart/byteranges response would require building a
    // custom MIME payload. Keeping this simple avoids extra allocations and complexity.
    let first_range = range_set.split(',').next().unwrap_or("").trim();
    let (start_part, end_part) = match first_range.split_once('-') {
        Some(parts) => parts,
        None => return Err(()),
    };

    let start_part = start_part.trim();
    let end_part = end_part.trim();

    if start_part.is_empty() {
        // Suffix range ("-N"): last N bytes.
        let suffix_len: u64 = end_part.parse().map_err(|_| ())?;
        if suffix_len == 0 {
            return Ok(None);
        }
        let suffix_len = suffix_len.min(size).min(MAX_RANGE_RESPONSE_BYTES);
        let start = size.saturating_sub(suffix_len);
        let end = size - 1;
        return Ok(Some(ByteRange { start, end }));
    }

    let start: u64 = start_part.parse().map_err(|_| ())?;
    if start >= size {
        return Ok(None);
    }

    let requested_end = if end_part.is_empty() {
        size - 1
    } else {
        let parsed: u64 = end_part.parse().map_err(|_| ())?;
        parsed.min(size - 1)
    };

    if requested_end < start {
        return Ok(None);
    }

    // Cap the response size to avoid reading extremely large ranges into memory.
    let max_end = start
        .saturating_add(MAX_RANGE_RESPONSE_BYTES.saturating_sub(1))
        .min(size - 1);
    let end = requested_end.min(max_end);

    Ok(Some(ByteRange { start, end }))
}
