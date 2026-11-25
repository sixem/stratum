use super::*;
use std::path::Path;
use std::time::Duration;

fn send(shell: &Session, text: &str) {
    shell
        .input
        .try_lock()
        .unwrap()
        .write_all(text.as_bytes())
        .unwrap();
}

async fn expect(shell: &Session, marker: &str) {
    let mut output = Vec::new();
    let mut reader = shell.output.lock().await;
    let result = tokio::time::timeout(Duration::from_secs(20), async {
        while let Some(chunk) = reader.recv().await {
            output.extend_from_slice(&chunk);
            while let Some(index) = output.windows(4).position(|w| w == b"\x1b[6n") {
                // Answer the cursor query as an emulator would, even across pipe reads.
                send(shell, "\x1b[1;1R");
                output.drain(index..index + 4);
            }
            if output.windows(marker.len()).any(|w| w == marker.as_bytes()) {
                return true;
            }
        }
        false
    })
    .await;
    assert_eq!(
        result.ok(),
        Some(true),
        "{}",
        String::from_utf8_lossy(&output)
    );
}

#[test]
fn powershell_round_trip_resize_interrupt_and_exit() {
    let exe = crate::services::shells::powershell_path().unwrap();
    let cwd = std::env::temp_dir();
    let shell = Session::new(process::spawn(&exe, "-NoLogo -NoProfile", &cwd, 80, 24).unwrap());
    tauri::async_runtime::block_on(async {
        shell
            .console
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .resize(101, 31)
            .unwrap();
        send(
            &shell,
            "[Console]::WriteLine('start' + 'test'); Start-Sleep -Seconds 90\r",
        );
        expect(&shell, "starttest").await;
        send(&shell, "\x03");
        expect(&shell, "PS ").await;
        send(&shell, "[Console]::WriteLine(('size' + [Console]::WindowWidth + 'x' + [Console]::WindowHeight)); exit\r");
        expect(&shell, "size101x31").await;
        let mut reader = shell.output.lock().await;
        tokio::time::timeout(Duration::from_secs(10), async {
            while reader.recv().await.is_some() {}
        })
        .await
        .unwrap();
    });
}

async fn expect_directory(
    reports: &mut mpsc::UnboundedReceiver<directory::Location>,
    version: u32,
    expected: &Path,
) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(report) = reports.recv().await {
            if report.version == version
                && report
                    .path
                    .as_deref()
                    .is_some_and(|path| Path::new(path) == expected)
            {
                assert!(report.error.is_none());
                return;
            }
        }
        panic!("Terminal stopped reporting its directory.");
    })
    .await
    .unwrap_or_else(|_| panic!("Missing directory report for {}", expected.display()));
}

#[test]
fn powershell_reports_directories_before_during_and_after_linking() {
    let exe = crate::services::shells::powershell_path().unwrap();
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let (send_report, mut reports) = mpsc::unbounded_channel();
    let bridge = directory::DirectoryBridge::new(move |location| {
        let _ = send_report.send(location);
    })
    .unwrap();
    let args = format!("-NoProfile {}", bridge.arguments());
    let shell = Session::new(process::spawn(&exe, &args, cwd, 80, 24).unwrap());

    tauri::async_runtime::block_on(async {
        expect(&shell, "PS ").await;
        expect_directory(&mut reports, 0, cwd).await;

        send(
            &shell,
            "Set-Location -LiteralPath src; [Console]::WriteLine('cwd-' + 'changed')\r",
        );
        expect(&shell, "cwd-changed").await;
        expect_directory(&mut reports, 0, &cwd.join("src")).await;

        bridge
            .update_link(1, Some(cwd.to_str().unwrap().to_owned()))
            .unwrap();
        expect_directory(&mut reports, 1, cwd).await;
        bridge.update_link(2, None).unwrap();
        expect_directory(&mut reports, 2, cwd).await;
    });
}

#[test]
#[ignore = "requires an installed Debian WSL distribution"]
fn wsl_debian_round_trip() {
    let exe = Path::new(r"C:\Windows\System32\wsl.exe");
    let shell = Session::new(
        process::spawn(
            exe,
            "-d Debian --exec /bin/sh -i",
            &std::env::temp_dir(),
            80,
            24,
        )
        .unwrap(),
    );
    tauri::async_runtime::block_on(async {
        send(&shell, "printf 'WSL-%s\\n' OK; exit\r");
        expect(&shell, "WSL-OK").await;
    });
}
