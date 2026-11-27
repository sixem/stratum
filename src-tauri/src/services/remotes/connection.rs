// Launch the system SSH client without a shell. OpenSSH owns credentials,
// proxy hops and host verification; stdout and stdin carry only SFTP packets.
use super::wire::Wire;
use std::{
    ffi::OsString,
    os::windows::ffi::OsStringExt,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex},
};
use tokio::{
    io::AsyncReadExt,
    process::{Child, Command},
};
use windows::Win32::System::SystemInformation::GetSystemDirectoryW;

pub(super) fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 255
        && !host.starts_with('-')
        && host
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-@:%[]".contains(&c))
}

fn executable() -> Result<PathBuf, String> {
    let mut buffer = [0u16; 32768];
    let count = unsafe { GetSystemDirectoryW(Some(&mut buffer)) } as usize;
    if count == 0 || count >= buffer.len() {
        return Err("Windows system directory unavailable.".into());
    }
    let exe = PathBuf::from(OsString::from_wide(&buffer[..count]))
        .join("OpenSSH")
        .join("ssh.exe");
    if !exe.is_file() {
        return Err("Install the Windows OpenSSH Client to use remote folders.".into());
    }
    Ok(exe)
}

pub(super) type Diagnostics = Arc<Mutex<Vec<u8>>>;
pub(super) fn spawn(host: &str) -> Result<(Child, Wire, Diagnostics), String> {
    #[cfg(test)]
    if host == "stratum-disposable" {
        if let Some(server) = std::env::var_os("STRATUM_SFTP_TEST_SUBSYSTEM") {
            // The fixture runs OpenSSH's actual subsystem on private pipes.
            // No listening port, SSH credentials, or external host is needed.
            let mut cmd = Command::new(server);
            cmd.arg("-d").arg(
                std::env::var("STRATUM_SFTP_OPERATIONS_DIR")
                    .map_err(|_| "Missing test fixture.")?,
            );
            return spawn_piped(cmd);
        }
    }
    crate::platform::windows::process_token::require_standard_token_for_tools()?;
    let mut cmd = Command::new(executable()?);
    // Live tests use an isolated SSH configuration instead of the user's hosts.
    #[cfg(test)]
    if let Some(config) = std::env::var_os("STRATUM_SFTP_TEST_SSH_CONFIG") {
        cmd.arg("-F").arg(config);
    }
    cmd.args([
        "-T",
        "-x",
        "-a",
        "-oBatchMode=yes",
        "-oStrictHostKeyChecking=yes",
        "-oUpdateHostKeys=no",
        "-oClearAllForwardings=yes",
        "-oPermitLocalCommand=no",
        "-oRemoteCommand=none",
        "-oControlPath=none",
        "-oConnectTimeout=10",
        "-oServerAliveInterval=15",
        "-oServerAliveCountMax=2",
        "-s",
        "--",
        host,
        "sftp",
    ])
    .env("SSH_ASKPASS_REQUIRE", "never");
    spawn_piped(cmd)
}

fn spawn_piped(mut cmd: Command) -> Result<(Child, Wire, Diagnostics), String> {
    cmd.creation_flags(0x08000000)
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start Windows OpenSSH: {e}"))?;
    let wire = Wire::new(child.stdin.take().unwrap(), child.stdout.take().unwrap());
    let diagnostics = Diagnostics::default();
    let sink = diagnostics.clone();
    let mut stderr = child.stderr.take().unwrap();
    tauri::async_runtime::spawn(async move {
        let mut chunk = [0u8; 1024];
        while let Ok(count) = stderr.read(&mut chunk).await {
            if count == 0 {
                break;
            }
            let mut buf = sink.lock().unwrap();
            buf.extend_from_slice(&chunk[..count]);
            let excess = buf.len().saturating_sub(2048);
            buf.drain(..excess);
        }
    });
    Ok((child, wire, diagnostics))
}
pub(super) fn failure(diagnostics: &Diagnostics, fallback: &str) -> String {
    let log = diagnostics.lock().unwrap();
    let message = String::from_utf8_lossy(&log);
    let lower = message.to_ascii_lowercase();
    if lower.contains("host key verification failed")
        || lower.contains("host identification has changed")
    {
        return "SSH host key could not be verified. Verify the host in Windows OpenSSH, then reconnect.".into();
    }
    if lower.contains("permission denied") {
        return "SSH authentication failed. Check your Windows OpenSSH key or agent.".into();
    }
    if lower.contains("subsystem request failed") {
        return "The host does not provide the SFTP subsystem.".into();
    }
    match message.lines().rev().find(|line| !line.trim().is_empty()) {
        Some(line) => format!(
            "{fallback} {}",
            line.chars()
                .filter(|c| !c.is_control())
                .take(300)
                .collect::<String>()
        ),
        None => fallback.to_owned(),
    }
}
