// Public thumbnail request/response types shared with commands and the UI.
use serde::{Deserialize, Serialize};

use super::ThumbKind;

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThumbView {
    Main,
    Bottom,
    Gallery,
}

impl ThumbView {
    pub(super) const COUNT: usize = 3;

    pub(super) fn index(self) -> usize {
        self as usize
    }
}

// A visit to a thumbnail view. The queue issues a new token each time it opens.
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbScope {
    pub view: ThumbView,
    pub generation: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbOptions {
    pub size: u32,
    pub quality: u8,
    pub format: ThumbFormat,
    pub allow_videos: bool,
    pub allow_svgs: bool,
    #[serde(default)]
    pub dark_svg_previews: bool,
    pub cache_mb: u32,
}

impl ThumbOptions {
    pub(super) fn format_for(&self, kind: ThumbKind) -> &ThumbFormat {
        // Dark SVG previews can have transparent pixels. JPEG cannot retain them.
        if self.dark_svg_previews && matches!(kind, ThumbKind::Svg) {
            &ThumbFormat::Webp
        } else {
            &self.format
        }
    }
}

// Optional size/modified fields let the UI skip filesystem metadata calls.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbRequest {
    pub path: String,
    pub size: Option<u64>,
    pub modified: Option<u64>,
    // Optional UI-provided signature so async events can confirm freshness.
    pub signature: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThumbFormat {
    Webp,
    Jpeg,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbHit {
    pub path: String,
    pub thumb_path: String,
    pub key: String,
    pub signature: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbReady {
    pub path: String,
    pub thumb_path: String,
    pub key: String,
    pub signature: String,
}
