// Drain both pipes independently. FFmpeg may spend time probing input or
// finalizing a container without writing a single progress line.
use super::{fs, FfmpegProgressSnapshot};
use std::io::{self, BufRead, BufReader, Read};
use std::process::Child;
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::thread;
use std::time::Duration;

const POLL: Duration = Duration::from_millis(100);

pub(super) fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

pub(super) fn run(
    mut child: Child,
    control: &mut Option<&mut fs::TransferControlCallback>,
    mut on_snapshot: impl FnMut(FfmpegProgressSnapshot),
) -> Result<(), String> {
    let stdout = child
        .stdout
        .take()
        .expect("FFmpeg stdout configured as piped");
    let stderr = child
        .stderr
        .take()
        .expect("FFmpeg stderr configured as piped");
    let diagnostics = thread::spawn(move || read_diagnostics(stderr));
    let (tx, rx) = sync_channel(2);
    let progress = thread::spawn(move || -> io::Result<()> {
        let mut snapshot = FfmpegProgressSnapshot::default();
        for line in BufReader::new(stdout).lines() {
            let line = line?;
            let Some((key, value)) = line.trim().split_once('=') else {
                continue;
            };
            if key == "progress" {
                if tx.send(std::mem::take(&mut snapshot)).is_err() {
                    break;
                }
            } else {
                snapshot.apply(key, value);
            }
        }
        Ok(())
    });

    let result: Result<_, String> = (|| {
        loop {
            if let Some(check) = control.as_deref_mut() {
                check()?;
            }
            match rx.recv_timeout(POLL) {
                Ok(snapshot) => on_snapshot(snapshot),
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        // Closing stdout can precede a slow flush of the output file.
        loop {
            if let Some(check) = control.as_deref_mut() {
                check()?;
            }
            if let Some(status) = child
                .try_wait()
                .map_err(|err| format!("Cannot wait for FFmpeg: {err}"))?
            {
                return Ok(status);
            }
            thread::sleep(POLL);
        }
    })();
    if result.is_err() {
        stop(&mut child);
    }
    drop(rx);
    let progress_result = progress.join();
    let detail = diagnostics.join().unwrap_or_default();
    let status = result?;
    if !status.success() {
        return Err(describe_failure(status.to_string(), &detail));
    }
    progress_result
        .map_err(|_| "FFmpeg progress reader stopped".to_string())?
        .map_err(|err| format!("Cannot read FFmpeg progress: {err}"))
}

// Keep the initial cause and final diagnostic even on a repeatedly corrupt
// stream. Read bytes because native builds can print paths in a local codepage.
fn read_diagnostics(mut reader: impl Read) -> String {
    const LIMIT: usize = 2048;
    let mut head = Vec::with_capacity(LIMIT);
    let mut tail = Vec::with_capacity(LIMIT);
    let mut omitted = false;
    let mut buffer = [0; LIMIT];
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(err) if err.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        let keep = count.min(LIMIT - head.len());
        head.extend_from_slice(&buffer[..keep]);
        let rest = &buffer[keep..count];
        let excess = (tail.len() + rest.len()).saturating_sub(LIMIT);
        if excess > 0 {
            tail.drain(..excess);
            omitted = true;
        }
        tail.extend_from_slice(rest);
    }
    if omitted {
        head.extend_from_slice(b"\n...\n");
    }
    head.extend(tail);
    String::from_utf8_lossy(&head).trim().to_owned()
}

fn describe_failure(status: String, detail: &str) -> String {
    if detail.contains("moov atom not found") {
        return "FFmpeg could not read the MP4/MOV header (moov atom not found). Check that the recording or download finished.".into();
    }
    if detail.contains("matches no streams") && detail.contains("0:V:0") {
        return "No playable video track was found in this file.".into();
    }
    if let Some(line) = detail.lines().find(|line| line.contains("Unknown encoder")) {
        let reason = line.split_once("Unknown encoder").unwrap().1.trim();
        return format!("This FFmpeg build does not include encoder {reason}. Select a build with this encoder in Settings.");
    }
    if detail.is_empty() {
        return format!("FFmpeg stopped with {status} and returned no diagnostic.");
    }
    detail.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_movie_header_is_reported_once_with_a_next_step() {
        let output = "[mov,mp4,m4a,3gp,3g2,mj2 @ 000001] moov atom not found\n\
            [in#0 @ 000002] Error opening input: Invalid data found when processing input\n\
            Error opening input file recording.mp4.\nError opening input files: Invalid data found when processing input";
        let message = describe_failure("exit code: 1".into(), output);
        assert_eq!(message.lines().count(), 1);
        assert!(message.contains("moov atom not found"));
        assert!(message.contains("Check that the recording or download finished"));
    }
    #[test]
    fn cancellation_during_a_silent_encoder_wait_reaps_the_child() {
        use std::process::{Command, Stdio};
        use std::time::Instant;
        // Launch this exact test as a quiet stand-in for a hung input probe.
        // The child exits on its own after ten seconds if cancellation regresses.
        const FLAG: &str = "STRATUM_TEST_SILENT_ENCODER_CHILD";
        if std::env::var_os(FLAG).is_some() {
            thread::sleep(Duration::from_secs(10));
            return;
        }
        let child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "domain::media::videos::process::tests::cancellation_during_a_silent_encoder_wait_reaps_the_child"])
            .env(FLAG, "1")
            .stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        let start = Instant::now();
        let mut check = move || {
            if start.elapsed() >= Duration::from_millis(180) {
                Err("cancelled".into())
            } else {
                Ok(())
            }
        };
        assert_eq!(
            run(child, &mut Some(&mut check), |_| {}).unwrap_err(),
            "cancelled"
        );
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn diagnostics_keep_the_first_cause_and_last_line_with_invalid_bytes() {
        let mut bytes = b"first cause \xff\n".to_vec();
        bytes.extend(vec![b'X'; 12_500]);
        bytes.extend_from_slice(b"\nfinal line");
        let message = read_diagnostics(&bytes[..]);
        assert!(message.starts_with("first cause"));
        assert!(message.ends_with("final line"));
        assert!(message.contains("\n...\n"));
        assert!(message.len() < 4200);
    }
}
