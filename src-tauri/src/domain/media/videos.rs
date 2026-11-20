// FFmpeg-backed video conversion helpers.
use crate::domain::filesystem as fs;
use serde::Deserialize;
use std::fs as std_fs;
mod process;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::CREATE_NO_WINDOW;

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
pub struct VideoConvertProgressOptions {
    pub completed_items: usize,
    pub total_items: usize,
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
    pub progress: Option<VideoConvertProgressOptions>,
}

pub(crate) struct VideoProgressUpdate {
    pub processed: usize,
    pub total: usize,
    pub current_path: Option<String>,
    pub progress_percent: Option<f64>,
    pub status_text: Option<String>,
    pub rate_text: Option<String>,
}

pub(crate) type VideoProgressCallback<'callback> = dyn FnMut(VideoProgressUpdate) + 'callback;

pub(super) fn convert_video(
    path: String,
    destination: String,
    options: VideoConvertOptions,
    tools: &super::ffmpeg::FfmpegTools,
    mut on_progress: Option<&mut VideoProgressCallback<'_>>,
    mut on_control: Option<&mut fs::TransferControlCallback>,
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
    if target.exists() && target.is_dir() {
        return Err("Destination is a folder".to_string());
    }
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            std_fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }

    validate_encoder_for_format(options.format, options.encoder)?;
    let quality = clamp_quality(options.encoder, options.quality);
    let progress_context = options
        .progress
        .as_ref()
        .filter(|value| value.total_items > 0);

    let duration_seconds = match (progress_context, tools.ffprobe.as_deref()) {
        (Some(_), Some(binary)) => probe_input_duration(source_path, binary, &mut on_control)?,
        _ => None,
    };
    let mut command = Command::new(&tools.ffmpeg);
    command
        .arg(if overwrite { "-y" } else { "-n" })
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-nostats")
        // An empty encoded stream can otherwise return success and replace its source.
        .args(["-abort_on", "empty_output_stream"])
        .arg("-stats_period")
        .arg("0.25")
        .arg("-progress")
        .arg("pipe:1")
        .arg("-i")
        .arg(source_path)
        // Capital V excludes embedded cover art and thumbnails.
        .args(["-map", "0:V:0"]);

    push_video_args(&mut command, options.encoder, options.speed, quality);
    push_audio_args(
        &mut command,
        options.format,
        options.audio_enabled.unwrap_or(true),
    );
    if matches!(options.format, VideoTargetFormat::Mp4) {
        command.arg("-movflags").arg("+faststart");
    }
    command.arg(destination_path);
    configure_media_command(&mut command);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let child = command.spawn().map_err(|err| {
        format!(
            "Could not start FFmpeg at {}: {err}",
            tools.ffmpeg.display()
        )
    })?;
    process::run(child, &mut on_control, |snapshot| {
        emit_conversion_progress(
            &mut on_progress,
            progress_context,
            source_path,
            duration_seconds,
            &snapshot,
            false,
        );
    })?;
    emit_completion_progress(
        &mut on_progress,
        progress_context,
        source_path,
        duration_seconds,
    );
    Ok(())
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
        VideoTargetFormat::Mkv => {
            matches!(encoder, VideoEncoder::Libx264 | VideoEncoder::LibvpxVp9)
        }
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
                // 4:2:0 requires even dimensions. Preserve every original pixel.
                .args(["-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0"])
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
    command.args(["-map", "0:a:0?"]);
    match format {
        VideoTargetFormat::Webm => {
            command.arg("-c:a").arg("libopus").arg("-b:a").arg("128k");
        }
        VideoTargetFormat::Avi => {
            command
                .args(["-af", "aformat=channel_layouts=mono|stereo"])
                .arg("-c:a")
                .arg("mp3")
                .arg("-b:a")
                .arg("192k");
        }
        VideoTargetFormat::Mp4 | VideoTargetFormat::Mkv | VideoTargetFormat::Mov => {
            command.arg("-c:a").arg("aac").arg("-b:a").arg("192k");
        }
    }
}

// Duration is optional. A slow probe must leave the job cancellable and must
// never prevent the main encoder from trying a playable file.
fn probe_input_duration(
    source: &str,
    ffprobe: &Path,
    control: &mut Option<&mut fs::TransferControlCallback>,
) -> Result<Option<f64>, String> {
    use std::io::Read;
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(source)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_media_command(&mut command);
    let Ok(mut child) = command.spawn() else {
        return Ok(None);
    };
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(check) = control.as_deref_mut() {
            if let Err(error) = check() {
                process::stop(&mut child);
                return Err(error);
            }
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return Ok(None),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(40)),
            _ => {
                process::stop(&mut child);
                return Ok(None);
            }
        }
    }
    let mut duration = String::new();
    if let Some(pipe) = child.stdout.take() {
        let _ = pipe.take(128).read_to_string(&mut duration);
    }
    Ok(duration
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0))
}

#[derive(Default)]
struct FfmpegProgressSnapshot {
    encoded_seconds: Option<f64>,
    speed_text: Option<String>,
}

impl FfmpegProgressSnapshot {
    fn apply(&mut self, key: &str, value: &str) {
        match key {
            "out_time" => {
                if let Some(seconds) = parse_ffmpeg_clock(value) {
                    self.encoded_seconds = Some(seconds);
                }
            }
            "out_time_us" => {
                if let Ok(micros) = value.parse::<f64>() {
                    self.encoded_seconds = Some(micros / 1_000_000.0);
                }
            }
            "speed" => {
                if !value.is_empty() && value != "N/A" {
                    self.speed_text = Some(value.to_string());
                }
            }
            _ => {}
        }
    }
}

fn emit_conversion_progress(
    callback: &mut Option<&mut VideoProgressCallback<'_>>,
    context: Option<&VideoConvertProgressOptions>,
    source_path: &str,
    duration_seconds: Option<f64>,
    snapshot: &FfmpegProgressSnapshot,
    is_end: bool,
) {
    let Some(context) = context else {
        return;
    };
    let Some(handler) = callback.as_mut() else {
        return;
    };
    let current_ratio = if is_end {
        Some(1.0)
    } else {
        match (snapshot.encoded_seconds, duration_seconds) {
            (Some(encoded), Some(total)) if total > 0.0 => Some((encoded / total).clamp(0.0, 1.0)),
            _ => None,
        }
    };
    let progress_percent = current_ratio.map(|ratio| {
        (((context.completed_items as f64) + ratio) / (context.total_items as f64) * 100.0)
            .clamp(0.0, 100.0)
    });
    let status_text = build_status_text(snapshot.encoded_seconds, duration_seconds, is_end);
    handler(VideoProgressUpdate {
        processed: context.completed_items,
        total: context.total_items,
        current_path: Some(source_path.to_string()),
        progress_percent,
        status_text,
        rate_text: snapshot.speed_text.clone(),
    });
}

fn emit_completion_progress(
    callback: &mut Option<&mut VideoProgressCallback<'_>>,
    context: Option<&VideoConvertProgressOptions>,
    source_path: &str,
    duration_seconds: Option<f64>,
) {
    let snapshot = FfmpegProgressSnapshot {
        encoded_seconds: duration_seconds,
        speed_text: None,
    };
    emit_conversion_progress(
        callback,
        context,
        source_path,
        duration_seconds,
        &snapshot,
        true,
    );
}

fn configure_media_command(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        // Keep ffmpeg/ffprobe from flashing a transient console window when the
        // GUI app launches them as background helpers.
        command.creation_flags(CREATE_NO_WINDOW.0);
    }
}

fn build_status_text(
    encoded_seconds: Option<f64>,
    duration_seconds: Option<f64>,
    is_end: bool,
) -> Option<String> {
    if is_end {
        return Some("Finalizing output".to_string());
    }
    match (encoded_seconds, duration_seconds) {
        (Some(encoded), Some(total)) if total > 0.0 => Some(format!(
            "{} / {}",
            format_clock_label(encoded),
            format_clock_label(total),
        )),
        (Some(encoded), None) => Some(format!("Encoded {}", format_clock_label(encoded))),
        _ => None,
    }
}

fn parse_ffmpeg_clock(value: &str) -> Option<f64> {
    let mut parts = value.split(':');
    let hours = parts.next()?.parse::<f64>().ok()?;
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds = parts.next()?.parse::<f64>().ok()?;
    Some((hours * 3600.0) + (minutes * 60.0) + seconds)
}

fn format_clock_label(value: f64) -> String {
    let total_seconds = value.max(0.0).round() as u64;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    if hours > 0 {
        return format!("{hours}:{minutes:02}:{seconds:02}");
    }
    format!("{minutes}:{seconds:02}")
}
