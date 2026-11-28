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
        return Err(MISSING_CLIENT.into());
    }
    Ok(exe)
}

const MISSING_CLIENT: &str = "Windows OpenSSH Client is missing. Install OpenSSH Client in Windows Settings under Optional features, then reconnect.";

pub(super) struct Diagnostics {
    log: Arc<Mutex<Vec<u8>>>,
    drained: tokio::sync::watch::Receiver<bool>,
}

impl Diagnostics {
    // SSH can close stdout or exit before its final stderr message is read.
    pub(super) async fn connection_error(&self, fallback: &str) -> String {
        let mut drained = self.drained.clone();
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            drained.wait_for(|done| *done),
        )
        .await;
        failure(self, fallback)
    }
}
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
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            MISSING_CLIENT.to_owned()
        } else {
            format!("Could not start Windows OpenSSH: {e}")
        }
    })?;
    let wire = Wire::new(child.stdin.take().unwrap(), child.stdout.take().unwrap());
    let (finished, drained) = tokio::sync::watch::channel(false);
    let diagnostics = Diagnostics {
        log: Arc::default(),
        drained,
    };
    let sink = diagnostics.log.clone();
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
        finished.send_replace(true);
    });
    Ok((child, wire, diagnostics))
}
pub(super) fn failure(diagnostics: &Diagnostics, fallback: &str) -> String {
    let log = diagnostics.log.lock().unwrap();
    explain(&String::from_utf8_lossy(&log), fallback)
}

fn explain(message: &str, fallback: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("host identification has changed")
        || lower.contains("host key for") && lower.contains("has changed")
    {
        return "The saved SSH host key has changed. Verify the new fingerprint with the host administrator. Only after it matches, update the affected entry in Windows OpenSSH known_hosts and reconnect.".into();
    }
    if lower.contains("host key verification failed") || lower.contains("strict checking") {
        return "SSH does not trust this host key. Run ssh with the same destination in Windows Terminal, compare the fingerprint with one from the host administrator, and accept it only if it matches. Then reconnect.".into();
    }
    if lower.contains("permission denied") {
        return "SSH authentication failed. Check the username and IdentityFile for this destination, load the key into the Windows SSH agent if needed, then test with ssh -o BatchMode=yes in Windows Terminal using the same destination.".into();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_failures_have_distinct_next_steps() {
        assert!(explain("Permission denied (publickey).", "").contains("IdentityFile"));
        assert!(explain(
            "No ED25519 host key is known\nHost key verification failed.",
            ""
        )
        .contains("accept it only if it matches"));
        assert!(explain(
            "REMOTE HOST IDENTIFICATION HAS CHANGED!\nHost key verification failed.",
            ""
        )
        .contains("update the affected entry"));
        assert!(explain("Connection refused", "SFTP failed.").contains("Connection refused"));
    }

    #[test]
    fn missing_client_and_late_ssh_diagnostics_reach_the_caller() {
        tauri::async_runtime::block_on(async {
            let absent = std::env::temp_dir()
                .join("stratum-no-such-openssh-client")
                .join("ssh.exe");
            let error = spawn_piped(Command::new(absent))
                .err()
                .expect("missing executable");
            assert!(error.contains("Optional features"));

            let (finished, drained) = tokio::sync::watch::channel(false);
            let diagnostic = Diagnostics {
                log: Arc::default(),
                drained,
            };
            let log = diagnostic.log.clone();
            tokio::spawn(async move {
                tokio::task::yield_now().await;
                log.lock()
                    .unwrap()
                    .extend_from_slice(b"Permission denied (publickey).");
                finished.send_replace(true);
            });
            assert!(diagnostic
                .connection_error("Disconnected")
                .await
                .contains("IdentityFile"));
        });
    }
}
