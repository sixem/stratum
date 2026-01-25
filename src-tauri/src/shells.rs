// Shell availability helpers for PowerShell 7+ and WSL.
use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct ShellAvailability {
    pub pwsh: bool,
    pub wsl: bool,
}

fn build_candidates(command: &str) -> Vec<String> {
  let path = Path::new(command);
  if path.extension().is_some() {
    return vec![command.to_string()];
  }
  vec![
    format!("{command}.exe"),
    format!("{command}.cmd"),
    format!("{command}.bat"),
  ]
}

fn find_on_path(command: &str) -> Option<PathBuf> {
  let path_var = match env::var_os("PATH") {
    Some(value) => value,
    None => return None,
  };
  let candidates = build_candidates(command);
  for dir in env::split_paths(&path_var) {
    for candidate in &candidates {
      let resolved = dir.join(candidate);
      if resolved.is_file() {
        return Some(resolved);
      }
    }
  }
  None
}

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

fn find_command_path(command: &str) -> Option<PathBuf> {
  if let Some(found) = find_on_path(command) {
    return Some(found);
  }
  for fallback in fallback_paths(command) {
    if fallback.is_file() {
      return Some(fallback);
    }
  }
  None
}

fn is_command_available(command: &str) -> bool {
  find_command_path(command).is_some()
}

pub fn get_shell_availability() -> ShellAvailability {
  ShellAvailability {
    // Treat Windows PowerShell as a fallback when pwsh isn't installed.
    pwsh: is_command_available("pwsh") || is_command_available("powershell"),
    wsl: is_command_available("wsl"),
  }
}

// Best-effort conversion of a Windows drive path into a WSL mount.
fn to_wsl_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.len() < 2 {
        return None;
    }
    let mut chars = trimmed.chars();
    let drive = chars.next()?;
    if chars.next()? != ':' {
        return None;
    }
    let drive = drive.to_ascii_lowercase();
    let rest = trimmed[2..].trim_start_matches(&['\\', '/']);
    let rest = rest.replace('\\', "/");
    if rest.is_empty() {
        return Some(format!("/mnt/{drive}"));
    }
    Some(format!("/mnt/{drive}/{rest}"))
}

fn spawn_pwsh(path: &str) -> Result<(), String> {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return Err("Missing working directory".to_string());
  }
  let pwsh_path = find_command_path("pwsh")
    .or_else(|| find_command_path("powershell"))
    .unwrap_or_else(|| PathBuf::from("powershell"));
  let escaped = trimmed.replace('\'', "''");
  let command = format!("Set-Location -LiteralPath '{escaped}'");
  spawn_in_new_console(
    &pwsh_path.to_string_lossy(),
    &[
      "-NoLogo".to_string(),
      "-NoExit".to_string(),
      "-Command".to_string(),
      command,
    ],
  )
}

fn spawn_wsl(path: &str) -> Result<(), String> {
  let trimmed = path.trim();
  let wsl_path = find_command_path("wsl").unwrap_or_else(|| PathBuf::from("wsl"));
  let mut args = Vec::new();
  if let Some(wsl_cd) = to_wsl_path(trimmed) {
    args.push("--cd".to_string());
    args.push(wsl_cd);
  }
  spawn_in_new_console(&wsl_path.to_string_lossy(), &args)
}

pub fn open_shell(kind: String, path: String) -> Result<(), String> {
  match kind.as_str() {
    "pwsh" => spawn_pwsh(&path),
    "wsl" => spawn_wsl(&path),
    _ => Err("Unknown shell kind".to_string()),
  }
}

// Launches a process in a new console window so the terminal is separate from the app.
fn spawn_in_new_console(exe: &str, args: &[String]) -> Result<(), String> {
  let cmd_path = env::var_os("ComSpec")
    .map(PathBuf::from)
    .filter(|path| path.is_file())
    .unwrap_or_else(|| PathBuf::from("cmd"));
  let mut cmd = Command::new(cmd_path);
  cmd.arg("/c").arg("start").arg("").arg(exe);
  for arg in args {
    cmd.arg(arg);
  }
  cmd.spawn()
    .map(|_| ())
    .map_err(|err| format!("Failed to launch shell: {err}"))
}
