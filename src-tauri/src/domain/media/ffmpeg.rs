// Resolve the same executable for Settings and conversion, even after PATH changes.
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};

mod verify;
#[cfg(windows)]
mod windows_path;

const FFMPEG: &str = if cfg!(windows) {
    "ffmpeg.exe"
} else {
    "ffmpeg"
};
const FFPROBE: &str = if cfg!(windows) {
    "ffprobe.exe"
} else {
    "ffprobe"
};

pub(crate) struct FfmpegTools {
    pub ffmpeg: PathBuf,
    pub ffprobe: Option<PathBuf>,
    pub notice: Option<String>,
}

impl FfmpegTools {
    pub fn resolve(configured: Option<&str>) -> Result<Self, String> {
        #[cfg(windows)]
        crate::platform::windows::process_token::require_standard_token_for_tools()?;

        let mut dirs: Vec<_> = env::var_os("PATH")
            .map(|path| env::split_paths(&path).collect())
            .unwrap_or_default();
        #[cfg(windows)]
        windows_path::append_install_dirs(&mut dirs);
        // Portable builds can keep the two tools beside Stratum.
        if let Ok(exe) = env::current_exe() {
            if let Some(parent) = exe.parent() {
                dirs.push(parent.to_owned());
            }
        }
        Self::from_dirs(configured, &dirs, verify::version)
    }

    fn from_dirs(
        configured: Option<&str>,
        dirs: &[PathBuf],
        mut verify: impl FnMut(&Path) -> Result<(), String>,
    ) -> Result<Self, String> {
        let mut checked = HashSet::new();
        let mut check = |path: &Path| {
            if !path.is_absolute() || !checked.insert(path.to_owned()) || !path.is_file() {
                return None;
            }
            // Windows treats batch shims as interpreter input. Accept native executables only.
            #[cfg(windows)]
            if !path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
            {
                return Some(Err(
                    "select an .exe file or a folder containing ffmpeg.exe".into()
                ));
            }
            Some(verify(path))
        };
        let mut notice = None;
        let configured = configured.unwrap_or_default().trim().trim_matches('"');
        if !configured.is_empty() {
            let path = Path::new(configured);
            let mut candidates = vec![path.to_owned()];
            if path.is_dir() {
                candidates = vec![path.join(FFMPEG), path.join("bin").join(FFMPEG)];
            }
            let mut message = format!("FFmpeg was not found at the configured path: {configured}");
            for path in candidates {
                if let Some(result) = check(&path) {
                    match result {
                        Ok(()) => return Ok(Self::with_probe(path, dirs, None)),
                        Err(reason) => {
                            message = format!("Configured FFmpeg at {}: {reason}", path.display())
                        }
                    }
                }
            }
            notice = Some(message);
        }

        let mut failure = None;
        for dir in dirs.iter().filter(|dir| dir.is_absolute()) {
            let candidate = dir.join(FFMPEG);
            match check(&candidate) {
                Some(Ok(())) => {
                    let notice =
                        notice.map(|reason| format!("{reason}. Using {}.", candidate.display()));
                    return Ok(Self::with_probe(candidate, dirs, notice));
                }
                Some(Err(reason)) if failure.is_none() => {
                    failure = Some(format!("FFmpeg at {}: {reason}", candidate.display()));
                }
                _ => {}
            }
        }
        let detail = notice
            .or(failure)
            .unwrap_or_else(|| "FFmpeg was not found on PATH".into());
        Err(format!("{detail}. Choose ffmpeg.exe in Settings."))
    }

    fn with_probe(ffmpeg: PathBuf, dirs: &[PathBuf], notice: Option<String>) -> Self {
        let sibling = ffmpeg.with_file_name(FFPROBE);
        let ffprobe = std::iter::once(sibling)
            .chain(
                dirs.iter()
                    .filter(|dir| dir.is_absolute())
                    .map(|dir| dir.join(FFPROBE)),
            )
            .find(|path| path.is_file());
        Self {
            ffmpeg,
            ffprobe,
            notice,
        }
    }
}

#[cfg(test)]
mod tests;
