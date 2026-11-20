// Locate external tools and launch Windows shells with structured arguments.
#[cfg(windows)]
use crate::platform::windows::process_token::require_standard_token_for_tools;
use serde::Serialize;
#[cfg(windows)]
use std::env;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::Command;
#[cfg(windows)]
use windows::Win32::System::Threading::CREATE_NEW_CONSOLE;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellAvailability {
    pub pwsh: bool,
    pub wsl: bool,
    pub ffmpeg: bool,
    pub ffmpeg_path: Option<String>,
    pub ffmpeg_message: Option<String>,
}

#[cfg(windows)]
fn find_on_path(command: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    let name = format!("{command}.exe");
    env::split_paths(&path_var)
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join(&name))
        .find(|file| file.is_file())
}

#[cfg(windows)]
fn fallback_paths(command: &str) -> Vec<PathBuf> {
    match command {
        "pwsh" => vec![
            PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe"),
            PathBuf::from(r"C:\Program Files\PowerShell\7-preview\pwsh.exe"),
            PathBuf::from(r"C:\Program Files (x86)\PowerShell\7\pwsh.exe"),
        ],
        "powershell" => vec![PathBuf::from(
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
        )],
        "wsl" => vec![PathBuf::from(r"C:\Windows\System32\wsl.exe")],
        _ => Vec::new(),
    }
}

#[cfg(windows)]
fn find_command_path(command: &str) -> Option<PathBuf> {
    find_on_path(command).or_else(|| {
        fallback_paths(command)
            .into_iter()
            .find(|file| file.is_file())
    })
}

#[cfg(windows)]
fn powershell_path() -> Option<PathBuf> {
    find_command_path("pwsh").or_else(|| find_command_path("powershell"))
}

pub fn get_shell_availability(configured: Option<&str>) -> ShellAvailability {
    #[cfg(windows)]
    if let Err(error) = require_standard_token_for_tools() {
        return ShellAvailability {
            ffmpeg_message: Some(error),
            ..Default::default()
        };
    }

    let tools = crate::domain::media::ffmpeg::FfmpegTools::resolve(configured);
    let (ffmpeg_path, ffmpeg_message) = match tools {
        Ok(tools) => (
            Some(tools.ffmpeg.to_string_lossy().into_owned()),
            tools.notice,
        ),
        Err(message) => (None, Some(message)),
    };
    #[cfg(windows)]
    let (pwsh, wsl) = (
        powershell_path().is_some(),
        find_command_path("wsl").is_some(),
    );
    #[cfg(not(windows))]
    let (pwsh, wsl) = (false, false);
    ShellAvailability {
        pwsh,
        wsl,
        ffmpeg: ffmpeg_path.is_some(),
        ffmpeg_path,
        ffmpeg_message,
    }
}

// Best-effort conversion of a Windows drive path into a WSL mount.
#[cfg(windows)]
fn to_wsl_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    let [drive, b':', separator, ..] = trimmed.as_bytes() else {
        return None;
    };
    if !drive.is_ascii_alphabetic() || !matches!(separator, b'\\' | b'/') {
        return None;
    }
    let drive = char::from(drive.to_ascii_lowercase());
    let rest = trimmed[2..].trim_start_matches(&['\\', '/']);
    let rest = rest.replace('\\', "/");
    if rest.is_empty() {
        return Some(format!("/mnt/{drive}"));
    }
    Some(format!("/mnt/{drive}/{rest}"))
}

#[cfg(windows)]
fn powershell_command(exe: &Path, directory: &Path) -> Command {
    let mut command = Command::new(exe);
    // Pass the folder to Windows as the initial working directory.
    command.args(["-NoLogo", "-NoExit"]).current_dir(directory);
    command
}

#[cfg(windows)]
fn wsl_command(exe: &Path, directory: &str) -> Command {
    let mut command = Command::new(exe);
    if let Some(wsl_dir) = to_wsl_path(directory) {
        command.arg("--cd").arg(wsl_dir);
    }
    command
}

#[cfg(windows)]
pub fn open_shell(kind: String, path: String) -> Result<(), String> {
    require_standard_token_for_tools()?;
    let directory = path.trim();
    let mut command = match kind.as_str() {
        "pwsh" => {
            let directory = Path::new(directory);
            if !directory.is_absolute() {
                return Err("The working directory must be an absolute path.".into());
            }
            let exe = powershell_path().ok_or("PowerShell is unavailable.")?;
            powershell_command(&exe, directory)
        }
        "wsl" => {
            let exe = find_command_path("wsl").ok_or("WSL is unavailable.")?;
            wsl_command(&exe, directory)
        }
        _ => return Err("Unknown shell kind".into()),
    };

    // A native console keeps the terminal separate from the desktop app.
    command
        .creation_flags(CREATE_NEW_CONSOLE.0)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("Failed to launch shell: {err}"))
}

#[cfg(not(windows))]
pub fn open_shell(_kind: String, _path: String) -> Result<(), String> {
    Err("Opening a terminal from Stratum requires Windows.".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn shell_commands_pass_the_folder_as_data() {
        let directory = r"D:\Project files\O'Brien’s notes";
        let powershell = powershell_command(Path::new(r"C:\Tools\pwsh.exe"), Path::new(directory));
        assert_eq!(powershell.get_current_dir(), Some(Path::new(directory)));
        assert_eq!(
            powershell.get_args().collect::<Vec<_>>(),
            ["-NoLogo", "-NoExit"]
        );

        let wsl = wsl_command(Path::new(r"C:\Windows\System32\wsl.exe"), directory);
        assert_eq!(
            wsl.get_args().collect::<Vec<_>>(),
            ["--cd", "/mnt/d/Project files/O'Brien’s notes"]
        );
        assert_eq!(to_wsl_path(r"D:\"), Some("/mnt/d".into()));
        assert_eq!(to_wsl_path(r"D:relative"), None);
    }
}
