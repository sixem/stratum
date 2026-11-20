use super::*;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

struct ToolsDir(PathBuf);

impl ToolsDir {
    fn new() -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("stratum ffmpeg {}-{id}", std::process::id()));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn file(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, []).unwrap();
        path
    }
}

impl Drop for ToolsDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn missing_or_broken_override_falls_back_to_working_installation() {
    let root = ToolsDir::new();
    let valid = root.file(&format!("installed/{FFMPEG}"));
    let broken = root.file(&format!("old/{FFMPEG}"));
    let dirs = vec![
        broken.parent().unwrap().into(),
        valid.parent().unwrap().into(),
    ];
    for override_path in [root.0.join("missing.exe"), broken.clone()] {
        let tools = FfmpegTools::from_dirs(override_path.to_str(), &dirs, |path| {
            if path == valid {
                Ok(())
            } else {
                Err("wrong executable".into())
            }
        })
        .unwrap();
        assert_eq!(tools.ffmpeg, valid);
        assert!(tools.ffprobe.is_none());
        assert!(tools
            .notice
            .as_deref()
            .unwrap()
            .contains(override_path.to_str().unwrap()));
    }
}

#[test]
fn quoted_executable_and_install_folder_prefer_their_own_probe() {
    let root = ToolsDir::new();
    let selected = root.file(&format!("custom folder/bin/{FFMPEG}"));
    let probe = root.file(&format!("custom folder/bin/{FFPROBE}"));
    let other = root.file(FFMPEG);
    root.file(FFPROBE);
    let dirs = [other.parent().unwrap().to_path_buf()];
    for path in [
        &selected,
        selected.parent().unwrap(),
        selected.parent().unwrap().parent().unwrap(),
    ] {
        let quoted = format!("  \"{}\"  ", path.display());
        let tools = FfmpegTools::from_dirs(Some(&quoted), &dirs, |_| Ok(())).unwrap();
        assert_eq!(tools.ffmpeg, selected);
        assert_eq!(tools.ffprobe.as_ref(), Some(&probe));
        assert!(tools.notice.is_none());
    }
}

#[test]
fn unavailable_ffmpeg_identifies_the_override_and_the_recovery_action() {
    let root = ToolsDir::new();
    let missing = root.0.join("deleted ffmpeg.exe");
    let error = FfmpegTools::from_dirs(missing.to_str(), &[], |_| unreachable!())
        .err()
        .unwrap();
    assert!(error.contains(missing.to_str().unwrap()));
    assert!(error.contains("Settings"));
}

#[test]
#[ignore = "requires an installed copy of FFmpeg"]
fn installed_ffmpeg_can_replace_a_missing_override() {
    let root = ToolsDir::new();
    let missing = root.0.join("previous-install").join(FFMPEG);
    let tools = FfmpegTools::resolve(missing.to_str()).unwrap();
    assert!(tools.ffmpeg.is_file());
    assert!(tools.notice.unwrap().contains(missing.to_str().unwrap()));
}
