// Public thumbnail request/response types shared with commands and the UI.
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbOptions {
    pub size: u32,
    pub quality: u8,
    pub format: ThumbFormat,
    pub allow_videos: bool,
    pub allow_svgs: bool,
    pub cache_mb: u32,
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
