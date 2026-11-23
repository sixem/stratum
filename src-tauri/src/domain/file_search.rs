// Parse the same file-size and type clauses for local and catalog searches.
use std::{borrow::Cow, collections::HashMap, sync::OnceLock};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct FileSearchFilters {
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    pub file_types: Vec<SearchFileType>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) enum SearchFileType {
    File,
    Folder,
    Video,
    Image,
    Audio,
    Archive,
    Document,
    Executable,
    Secure,
    Extension(String),
}

pub(crate) struct FileSearch<'a> {
    pub name_query: Cow<'a, str>,
    pub filters: FileSearchFilters,
}

impl<'a> FileSearch<'a> {
    pub(crate) fn parse(query: &'a str) -> Self {
        let query = query.trim();
        let mut filters = FileSearchFilters::default();
        if !query.contains(['<', '>', '=', ':']) {
            return Self {
                name_query: Cow::Borrowed(query),
                filters,
            };
        }

        let mut name_terms = Vec::new();
        for token in query.split_whitespace() {
            if let Some((min, max)) = parse_size_clause(token) {
                if let Some(min) = min {
                    filters.min_size = Some(filters.min_size.map_or(min, |bound| bound.max(min)));
                }
                if let Some(max) = max {
                    filters.max_size = Some(filters.max_size.map_or(max, |bound| bound.min(max)));
                }
            } else if let Some(file_type) = parse_type_clause(token) {
                if !filters.file_types.contains(&file_type) {
                    filters.file_types.push(file_type);
                }
            } else {
                name_terms.push(token);
            }
        }

        let name_query = if filters.has_filters() {
            Cow::Owned(name_terms.join(" "))
        } else {
            Cow::Borrowed(query)
        };
        Self {
            name_query,
            filters,
        }
    }
}

impl FileSearchFilters {
    pub(crate) fn has_size(&self) -> bool {
        self.min_size.is_some() || self.max_size.is_some()
    }

    pub(crate) fn has_filters(&self) -> bool {
        self.has_size() || !self.file_types.is_empty()
    }

    pub(crate) fn matches_size(&self, size: Option<u64>) -> bool {
        !self.has_size()
            || size.is_some_and(|size| {
                self.min_size.is_none_or(|min| size >= min)
                    && self.max_size.is_none_or(|max| size <= max)
            })
    }

    pub(crate) fn matches_type(&self, normalized_name: &str, is_dir: bool) -> bool {
        if self.file_types.is_empty() {
            return true;
        }
        if is_dir {
            return self
                .file_types
                .iter()
                .all(|kind| *kind == SearchFileType::Folder);
        }
        let extension = normalized_name
            .rsplit_once('.')
            .filter(|(stem, extension)| !stem.is_empty() && !extension.is_empty())
            .map(|(_, extension)| extension);
        self.file_types.iter().all(|kind| match kind {
            SearchFileType::File => true,
            SearchFileType::Folder => false,
            SearchFileType::Extension(expected) => extension == Some(expected.as_str()),
            category => {
                extension.and_then(|extension| file_categories().get(extension)) == Some(category)
            }
        })
    }
}

fn parse_type_clause(token: &str) -> Option<SearchFileType> {
    let (key, value) = token.split_once(':')?;
    if key.eq_ignore_ascii_case("ext") {
        let extension = value.strip_prefix('.').unwrap_or(value);
        return (!extension.is_empty()
            && extension
                .chars()
                .all(|c| c.is_alphanumeric() || c == '_' || c == '-'))
        .then(|| SearchFileType::Extension(extension.to_lowercase()));
    }
    if !key.eq_ignore_ascii_case("type") {
        return None;
    }
    match value.to_ascii_lowercase().as_str() {
        "file" => Some(SearchFileType::File),
        "folder" | "directory" | "dir" => Some(SearchFileType::Folder),
        "video" => Some(SearchFileType::Video),
        "image" => Some(SearchFileType::Image),
        "audio" => Some(SearchFileType::Audio),
        "archive" => Some(SearchFileType::Archive),
        "document" => Some(SearchFileType::Document),
        "executable" => Some(SearchFileType::Executable),
        "secure" => Some(SearchFileType::Secure),
        _ => None,
    }
}

fn file_categories() -> &'static HashMap<&'static str, SearchFileType> {
    static CATEGORIES: OnceLock<HashMap<&str, SearchFileType>> = OnceLock::new();
    CATEGORIES.get_or_init(|| {
        let lists: HashMap<&str, Vec<&str>> =
            serde_json::from_str(include_str!("../../../src/constants/fileKinds.json"))
                .expect("valid shared file extension lists");
        let mut categories = HashMap::new();
        // Match the precedence used for file icons and galleries in the app.
        for (name, category) in [
            ("script", SearchFileType::Executable),
            ("executable", SearchFileType::Executable),
            ("video", SearchFileType::Video),
            ("image", SearchFileType::Image),
            ("audio", SearchFileType::Audio),
            ("archive", SearchFileType::Archive),
            ("secure", SearchFileType::Secure),
            ("config", SearchFileType::Document),
            ("code", SearchFileType::Document),
            ("document", SearchFileType::Document),
        ] {
            for extension in &lists[name] {
                categories
                    .entry(*extension)
                    .or_insert_with(|| category.clone());
            }
        }
        categories
    })
}

fn parse_size_clause(token: &str) -> Option<(Option<u64>, Option<u64>)> {
    // Normalize strict comparisons to inclusive integer bounds for SQLite and listings.
    const LARGEST_SIZE: u64 = i64::MAX as u64;
    const EMPTY_RANGE: (Option<u64>, Option<u64>) = (Some(1), Some(0));
    let explicit = token
        .split_once(':')
        .filter(|(key, _)| key.eq_ignore_ascii_case("size"));
    let value = explicit.map_or(token, |(_, value)| value);
    let operator_len = if ["<=", ">=", "=="]
        .iter()
        .any(|operator| value.starts_with(*operator))
    {
        2
    } else if value.starts_with(['<', '>', '=']) {
        1
    } else if explicit.is_some() {
        0
    } else {
        return None;
    };
    let (operator, amount) = value.split_at(operator_len);
    let (floor, ceil) = parse_byte_amount(amount)?;
    Some(match operator {
        ">" if floor >= LARGEST_SIZE => EMPTY_RANGE,
        ">" => (Some(floor + 1), None),
        ">=" if ceil > LARGEST_SIZE => EMPTY_RANGE,
        ">=" => (Some(ceil), None),
        "<" if ceil == 0 => EMPTY_RANGE,
        "<" => (None, Some(ceil - 1)),
        "<=" => (None, Some(floor)),
        _ if ceil > LARGEST_SIZE => EMPTY_RANGE,
        _ => (Some(ceil), Some(floor)),
    })
}

fn parse_byte_amount(amount: &str) -> Option<(u64, u64)> {
    let unit_start = amount
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(amount.len());
    let (number, unit) = amount.split_at(unit_start);
    // Match the 1024-based size labels used throughout Stratum.
    let power = match unit.to_ascii_lowercase().as_str() {
        "" | "b" => 0,
        "kb" | "kib" => 1,
        "mb" | "mib" => 2,
        "gb" | "gib" => 3,
        "tb" | "tib" => 4,
        "pb" | "pib" => 5,
        _ => return None,
    };
    let scale = 1024_u128.pow(power);
    let (whole, fraction) = number.split_once('.').unwrap_or((number, ""));
    let whole = if whole.is_empty() && !fraction.is_empty() {
        0
    } else {
        whole.parse::<u128>().ok()?
    };
    let whole_bytes = whole.checked_mul(scale)?;
    let (floor, ceil) = if fraction.is_empty() {
        (whole_bytes, whole_bytes)
    } else {
        let divisor = 10_u128.checked_pow(u32::try_from(fraction.len()).ok()?)?;
        let numerator = fraction.parse::<u128>().ok()?.checked_mul(scale)?;
        (
            whole_bytes.checked_add(numerator / divisor)?,
            whole_bytes.checked_add(numerator.div_ceil(divisor))?,
        )
    };
    let max = i64::MAX as u128;
    Some((floor.min(max) as u64, ceil.min(max + 1) as u64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_terms_and_combines_size_bounds() {
        let search = FileSearch::parse("concert >1GB type:video live SIZE:<=1.5GiB ext:.MP4");
        assert_eq!(search.name_query, "concert live");
        assert_eq!(search.filters.min_size, Some(1_073_741_825));
        assert_eq!(search.filters.max_size, Some(1_610_612_736));
        assert!(!search.filters.matches_size(Some(1_073_741_824)));
        assert!(search.filters.matches_size(Some(1_610_612_736)));
        assert!(!search.filters.matches_size(None));
        assert!(search.filters.matches_type("concert live.mp4", false));
        assert!(!search.filters.matches_type("concert live.webm", false));
        assert!(!search.filters.matches_type("concert live.mp4", true));
    }

    #[test]
    fn preserves_literal_queries_and_handles_byte_boundaries() {
        for name in [
            "concert  live",
            "photo>=old",
            "size:huge notes",
            "aaa type:",
        ] {
            let search = FileSearch::parse(name);
            assert_eq!(search.name_query, name);
            assert!(!search.filters.has_filters());
        }

        for (query, expected) in [
            ("<1.5B", [true, true, false]),
            (">1.5B", [false, false, true]),
            ("=1.5B", [false, false, false]),
            ("size:1B", [false, true, false]),
            ("<0B", [false, false, false]),
            (">=0B", [true, true, true]),
            (">9PB <1PB", [false, false, false]),
        ] {
            assert_eq!(
                [0, 1, 2].map(|size| FileSearch::parse(query).filters.matches_size(Some(size))),
                expected,
                "{query}",
            );
        }
    }

    #[test]
    fn matches_the_app_categories_and_distinguishes_directories() {
        let secure = FileSearch::parse("type:secure");
        let docs = FileSearch::parse("type:document");
        assert!(secure.filters.matches_type("project.key", false));
        assert!(!docs.filters.matches_type("project.key", false));
        assert!(docs.filters.matches_type("settings.toml", false));
        assert!(!docs.filters.matches_type("settings.toml", true));
        assert!(!docs.filters.matches_type(".toml", false));
        assert!(FileSearch::parse("type:folder")
            .filters
            .matches_type("backup.mp4", true));
        assert!(!FileSearch::parse("type:file")
            .filters
            .matches_type("backup.mp4", true));
        assert!(FileSearch::parse("type:video")
            .filters
            .matches_type("archive.ogv", false));
        assert!(FileSearch::parse("type:executable")
            .filters
            .matches_type("script.cmd", false));
    }
}
