// A file named ffmpeg.exe may be a broken install or the wrong program.
use std::io::{self, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

pub(super) fn version(path: &Path) -> Result<(), String> {
    let mut command = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows::Win32::System::Threading::CREATE_NO_WINDOW;
        command.creation_flags(CREATE_NO_WINDOW.0);
    }
    let mut child = command
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| format!("could not start ({err})"))?;
    let mut output = child.stdout.take().expect("piped stdout");
    let (send, receive) = mpsc::channel();
    thread::spawn(move || {
        let mut prefix = [0; b"ffmpeg version ".len()];
        let is_ffmpeg = output.read_exact(&mut prefix).is_ok() && prefix == *b"ffmpeg version ";
        let _ = send.send(is_ffmpeg);
        // A full build can print a long configuration line. Drain without retaining it.
        let _ = io::copy(&mut output, &mut io::sink());
    });
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                return match receive
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                {
                    Ok(true) => Ok(()),
                    _ => Err("did not identify itself as FFmpeg".into()),
                };
            }
            Ok(Some(status)) => return Err(format!("version check failed ({status})")),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(result
                    .err()
                    .map_or_else(|| "version check timed out".into(), |err| err.to_string()));
            }
        }
    }
}
