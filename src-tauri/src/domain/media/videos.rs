// FFmpeg-backed video conversion helpers.
use serde::Deserialize;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoTargetFormat {
    Mp4,
    Webm,
    Mkv,
    Mov,
    Avi,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VideoEncoder {
    Libx264,
    LibvpxVp9,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoSpeed {
    Fast,
    Balanced,
    Quality,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoConvertOptions {
    pub format: VideoTargetFormat,
    pub encoder: VideoEncoder,
    pub speed: VideoSpeed,
    pub quality: u8,
    pub audio_enabled: Option<bool>,
    pub overwrite: Option<bool>,
    pub ffmpeg_path: Option<String>,
}

pub fn convert_video(
    path: String,
    destination: String,
    options: VideoConvertOptions,
) -> Result<(), String> {
    let source_path = path.trim();
    let destination_path = destination.trim();
    if source_path.is_empty() {
        return Err("Empty source path".to_string());
    }
    if destination_path.is_empty() {
        return Err("Empty destination path".to_string());
    }

    let source = Path::new(source_path);
    if !source.exists() {
        return Err("Source does not exist".to_string());
    }
    if source.is_dir() {
        return Err("Source is a folder".to_string());
    }

    let target = Path::new(destination_path);
    let overwrite = options.overwrite.unwrap_or(false);
    if target.exists() && !overwrite {
        return Err("Destination already exists".to_string());
    }
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }

    validate_encoder_for_format(options.format, options.encoder)?;
    let quality = clamp_quality(options.encoder, options.quality);
    let ffmpeg_bin = resolve_ffmpeg_binary(options.ffmpeg_path.as_deref());

    let mut command = Command::new(ffmpeg_bin);
    command
        .arg(if overwrite { "-y" } else { "-n" })
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-i")
        .arg(source_path);

    push_video_args(&mut command, options.encoder, options.speed, quality);
    push_audio_args(&mut command, options.format, options.audio_enabled.unwrap_or(true));
    if matches!(options.format, VideoTargetFormat::Mp4) {
        command.arg("-movflags").arg("+faststart");
    }
    command.arg(destination_path);
    command.stdout(Stdio::null()).stderr(Stdio::piped());

    let output = command.output().map_err(|err| {
        format!("Failed to launch ffmpeg: {err}")
    })?;

    if output.status.success() {
        return Ok(());
    }

    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if detail.is_empty() {
        Err("ffmpeg conversion failed".to_string())
    } else {
        Err(detail)
    }
}

fn resolve_ffmpeg_binary(explicit_path: Option<&str>) -> String {
    let trimmed = explicit_path.unwrap_or_default().trim();
    if trimmed.is_empty() {
        return "ffmpeg".to_string();
    }
    let candidate = Path::new(trimmed);
    if candidate.is_dir() {
        return candidate.join("ffmpeg.exe").to_string_lossy().to_string();
    }
    trimmed.to_string()
}

fn validate_encoder_for_format(
    format: VideoTargetFormat,
    encoder: VideoEncoder,
) -> Result<(), String> {
    let supported = match format {
        VideoTargetFormat::Webm => matches!(encoder, VideoEncoder::LibvpxVp9),
        VideoTargetFormat::Mp4 | VideoTargetFormat::Mov | VideoTargetFormat::Avi => {
            matches!(encoder, VideoEncoder::Libx264)
        }
        VideoTargetFormat::Mkv => matches!(encoder, VideoEncoder::Libx264 | VideoEncoder::LibvpxVp9),
    };
    if supported {
        Ok(())
    } else {
        Err("Selected encoder is not supported for this target format".to_string())
    }
}

fn clamp_quality(encoder: VideoEncoder, value: u8) -> u8 {
    match encoder {
        VideoEncoder::Libx264 => value.clamp(16, 30),
        VideoEncoder::LibvpxVp9 => value.clamp(18, 36),
    }
}

fn push_video_args(command: &mut Command, encoder: VideoEncoder, speed: VideoSpeed, quality: u8) {
    match encoder {
        VideoEncoder::Libx264 => {
            let preset = match speed {
                VideoSpeed::Fast => "ultrafast",
                VideoSpeed::Balanced => "veryfast",
                VideoSpeed::Quality => "slow",
            };
            command
                .arg("-c:v")
                .arg("libx264")
                .arg("-preset")
                .arg(preset)
                .arg("-crf")
                .arg(quality.to_string())
                .arg("-pix_fmt")
                .arg("yuv420p");
        }
        VideoEncoder::LibvpxVp9 => {
            let (cpu_used, deadline) = match speed {
                VideoSpeed::Fast => ("6", "realtime"),
                VideoSpeed::Balanced => ("4", "good"),
                VideoSpeed::Quality => ("2", "good"),
            };
            command
                .arg("-c:v")
                .arg("libvpx-vp9")
                .arg("-crf")
                .arg(quality.to_string())
                .arg("-b:v")
                .arg("0")
                .arg("-deadline")
                .arg(deadline)
                .arg("-cpu-used")
                .arg(cpu_used);
        }
    }
}

fn push_audio_args(command: &mut Command, format: VideoTargetFormat, audio_enabled: bool) {
    if !audio_enabled {
        command.arg("-an");
        return;
    }
    match format {
        VideoTargetFormat::Webm => {
            command.arg("-c:a").arg("libopus").arg("-b:a").arg("128k");
        }
        VideoTargetFormat::Avi => {
            command.arg("-c:a").arg("mp3").arg("-b:a").arg("192k");
        }
        VideoTargetFormat::Mp4 | VideoTargetFormat::Mkv | VideoTargetFormat::Mov => {
            command.arg("-c:a").arg("aac").arg("-b:a").arg("192k");
        }
    }
}
