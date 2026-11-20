// Exercise the conversion payload sent by the modal, including commits and
// per-source failure reporting. The optional round trip needs FFmpeg on PATH.
use super::{convert_items, ConversionJobItem};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        loop {
            let dir = std::env::temp_dir().join(format!(
                "stratum video test {} {}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&dir) {
                Ok(()) => return Self(dir),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => panic!("Cannot create a test directory: {e}"),
            }
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).expect("clean up disposable clips");
    }
}

fn video(
    source: &Path,
    output: &Path,
    format: &str,
    audio: bool,
    replace: bool,
) -> ConversionJobItem {
    serde_json::from_value(json!({
        "kind": "video", "sourcePath": source, "destinationPath": output,
        "deleteSourceAfterSuccess": replace && source != output,
        "options": {
            "format": format, "encoder": if format == "webm" { "libvpx-vp9" } else { "libx264" },
            "speed": "fast", "quality": 24, "audioEnabled": audio, "overwrite": replace,
            "ffmpegPath": source.with_file_name("missing-install").join("ffmpeg.exe")
        }
    }))
    .unwrap()
}

#[test]
fn colliding_batch_is_rejected_before_changing_either_input() {
    let files = Fixture::new();
    let a = files.0.join("source.mov");
    let b = files.0.join("source.mp4");
    fs::write(&a, b"first original").unwrap();
    fs::write(&b, b"second original").unwrap();
    let incoming = video(&a, &b, "mp4", true, true);
    let in_place = video(&b, &b, "mp4", true, true);
    for items in [
        vec![incoming.clone(), in_place.clone()],
        vec![in_place, incoming],
    ] {
        assert!(convert_items(items, None, None).is_err());
    }
    let output = files.0.join("out.mp4");
    assert!(convert_items(
        vec![
            video(&a, &output, "mp4", true, false),
            video(&b, &output, "mp4", true, false)
        ],
        None,
        None
    )
    .is_err());
    assert!(!output.exists());
    assert_eq!(fs::read(a).unwrap(), b"first original");
    assert_eq!(fs::read(b).unwrap(), b"second original");
}

fn run(command: &mut Command) -> Vec<u8> {
    let result = command.output().expect("start FFmpeg test tool");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    result.stdout
}

fn streams(path: &Path) -> Vec<Value> {
    let output = run(Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,codec_type,width,height",
            "-of",
            "json",
        ])
        .arg(path));
    let probe: Value = serde_json::from_slice(&output).unwrap();
    probe["streams"].as_array().unwrap().clone()
}

#[test]
#[ignore = "requires ffmpeg and ffprobe on PATH with H.264 and VP9 encoding"]
fn installed_ffmpeg_converts_disposable_clips_and_reports_only_failed_sources() {
    let files = Fixture::new();
    let original = files.0.join("første klipp.mp4");
    // 4:4:4 permits an odd-sized source that fails a straight 4:2:0 re-encode.
    run(Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=77x55:rate=10",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440",
            "-t",
            "0.5",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv444p",
            "-c:a",
            "aac",
        ])
        .arg(&original));
    let original_bytes = fs::read(&original).unwrap();
    for format in ["mp4", "webm", "mkv", "mov", "avi"] {
        let output = files.0.join(format!("out.{format}"));
        let audio = format != "mov";
        let report = convert_items(
            vec![video(&original, &output, format, audio, false)],
            None,
            None,
        )
        .unwrap();
        assert_eq!(report.converted, 1, "{format}: {:?}", report.failures);
        let tracks = streams(&output);
        let picture = tracks.iter().find(|s| s["codec_type"] == "video").unwrap();
        assert_eq!(
            picture["codec_name"],
            if format == "webm" { "vp9" } else { "h264" }
        );
        if format != "webm" {
            assert_eq!(
                (&picture["width"], &picture["height"]),
                (&json!(78), &json!(56))
            );
        }
        assert_eq!(tracks.iter().any(|s| s["codec_type"] == "audio"), audio);
        run(Command::new("ffmpeg")
            .args(["-v", "error", "-xerror", "-i"])
            .arg(output)
            .args(["-f", "null", "-"]));
    }
    assert_eq!(fs::read(&original).unwrap(), original_bytes);

    let corrupt = files.0.join("broken.mp4");
    let previous = files.0.join("existing.mkv");
    fs::write(&corrupt, b"invalid video").unwrap();
    fs::write(&previous, b"previous destination").unwrap();
    let report = convert_items(
        vec![
            video(&corrupt, &previous, "mkv", true, true),
            video(&original, &original, "mp4", false, true),
        ],
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        (report.converted, report.failed),
        (1, 1),
        "{:?}",
        report.failures
    );
    assert_eq!(report.failed_sources, [corrupt.to_string_lossy()]);
    assert_eq!(fs::read(&corrupt).unwrap(), b"invalid video");
    assert_eq!(fs::read(&previous).unwrap(), b"previous destination");
    assert_eq!(streams(&original).len(), 1);
    assert!(!fs::read_dir(&files.0)
        .unwrap()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().contains(".stratum-")));
}

#[path = "output_tests.rs"]
mod output_tests;
