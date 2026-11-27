use super::*;

#[test]
fn destinations_and_remote_paths_are_independent_of_windows_shell_syntax() {
    assert!(connection::valid_host("dev@mirai.server"));
    for invalid in ["-F", "host -p 42", "host/dir", "host\narg", "h;whoami"] {
        assert!(!connection::valid_host(invalid));
    }
    for valid in ["/", "/srv/App", "/srv/app", "/home/me/ b "] {
        assert!(check_path(valid, false).is_ok());
    }
    assert!(check_path("C:\\foo", false).is_err());
}
#[test]
fn unsupported_remote_images_are_skipped() {
    assert!(thumbnail::supported("/home/me/image.JPG"));
    assert!(!thumbnail::supported("/home/me/image.svg"));
    assert_eq!(thumbnail::decode(b"not an image".to_vec()), None);
}

#[test]
#[ignore = "set STRATUM_SFTP_TEST_HOST to a trusted Windows OpenSSH alias with / and /var"]
fn browse_two_remote_folders_on_one_sftp_process() {
    tauri::async_runtime::block_on(async {
        let remotes = Remotes::default();
        let host = std::env::var("STRATUM_SFTP_TEST_HOST").expect("Set a trusted SFTP test host");
        let exit: OnExit = Arc::new(|_| {});
        let (one, second) = tokio::join!(
            remotes.connect("smoke", &host, "", exit.clone()),
            remotes.connect("smoke", &host, "", exit)
        );
        let connection = one.unwrap();
        assert_eq!(second.unwrap().session_id, connection.session_id);
        eprintln!(
            "Connected with zero tabs; SSH process {}",
            connection.session_id
        );
        let (root, var) = tokio::join!(
            remotes.list("smoke", "/", Some(connection.session_id)),
            remotes.list("smoke", "/var", Some(connection.session_id))
        );
        let (root, var) = (root.unwrap(), var.unwrap());
        assert_eq!(root.path, "/");
        assert_eq!(var.path, "/var");
        assert_eq!(root.session_id, var.session_id);
        assert!(!root.entries.is_empty() && !var.entries.is_empty());
        eprintln!(
            "/ ({} entries) and /var ({} entries) shared SSH process {}.",
            root.entries.len(),
            var.entries.len(),
            root.session_id
        );
        assert!(remotes
            .list(
                "smoke",
                "/path-that-does-not-exist-stratum-remote-test",
                Some(root.session_id)
            )
            .await
            .is_err());
        assert!(remotes.current("smoke", Some(root.session_id)).is_ok());
        if let Ok(path) = std::env::var("STRATUM_SFTP_TEST_IMAGE") {
            let first = remotes
                .read_range("smoke", connection.session_id, &path, 0, 16)
                .await
                .unwrap();
            let rest = remotes
                .read_range("smoke", connection.session_id, &path, 16, file::MAX_READ)
                .await
                .unwrap();
            assert_eq!(first.bytes.len(), 16);
            assert_eq!(first.size, rest.size);
            assert!(first.modified.is_some());
            let data = [first.bytes, rest.bytes].concat();
            assert_eq!(data.len() as u64, first.size);
            let end = remotes
                .read_range("smoke", connection.session_id, &path, first.size - 5, 100)
                .await
                .unwrap();
            assert_eq!(end.bytes, data[data.len() - 5..]);
            let beyond = remotes
                .read_range("smoke", connection.session_id, &path, first.size + 100, 20)
                .await
                .unwrap();
            assert!(beyond.bytes.is_empty());
            assert!(remotes
                .read_range("smoke", connection.session_id, "/", 0, 10)
                .await
                .is_err());
            assert!(thumbnail::decode(data)
                .unwrap()
                .starts_with("data:image/webp;base64,"));
            assert!(remotes
                .read_range("smoke", connection.session_id, &path, 0, file::MAX_READ + 1)
                .await
                .is_err());
            assert!(remotes
                .read_range("smoke", connection.session_id, &path, u64::MAX, 1)
                .await
                .is_err());
            assert!(remotes
                .current("smoke", Some(connection.session_id))
                .is_ok());
            eprintln!("Verified bounded positional reads, metadata, and decoding.");
        }
        if let Ok(path) = std::env::var("STRATUM_SFTP_TEST_RANGE") {
            let combined = remotes
                .read_range("smoke", connection.session_id, &path, 65530, 65560)
                .await
                .unwrap();
            let left = remotes
                .read_range("smoke", connection.session_id, &path, 65530, 33000)
                .await
                .unwrap();
            let right = remotes
                .read_range("smoke", connection.session_id, &path, 98530, 32560)
                .await
                .unwrap();
            assert_eq!(combined.bytes.len(), 65560);
            assert_eq!(combined.bytes, [left.bytes, right.bytes].concat());
            let source = crate::services::preview_protocol::RemoteSource {
                remotes: remotes.clone(),
                profile_id: "smoke".into(),
                session_id: connection.session_id,
                path: path.clone(),
                size: combined.size,
                modified: combined.modified,
                cache_generation: 0,
                thumbnail: None,
            };
            let response = crate::services::preview_protocol::test_remote_response(
                source.clone(),
                Some("bytes=65530-131089"),
                false,
            )
            .await;
            assert_eq!(response.status(), 206);
            assert_eq!(response.body(), &combined.bytes);
            if combined.size > 512 * 1024 {
                let first = crate::services::preview_protocol::test_remote_response(
                    source.clone(),
                    Some("bytes=0-"),
                    false,
                )
                .await;
                assert_eq!(first.status(), 206);
                assert_eq!(first.body().len(), 512 * 1024);
            }
            let head =
                crate::services::preview_protocol::test_remote_response(source.clone(), None, true)
                    .await;
            assert_eq!(head.status(), 200);
            assert_eq!(head.headers()["content-length"], combined.size.to_string());
            let bad_range = format!("bytes={}-", combined.size);
            let rejected = crate::services::preview_protocol::test_remote_response(
                source.clone(),
                Some(&bad_range),
                false,
            )
            .await;
            assert_eq!(rejected.status(), 416);
            let changed = crate::services::preview_protocol::RemoteSource {
                size: combined.size + 1,
                ..source
            };
            let stale = crate::services::preview_protocol::test_remote_response(
                changed,
                Some("bytes=0-100"),
                false,
            )
            .await;
            assert_eq!(stale.status(), 409);
            eprintln!(
                "Verified byte ranges crossing SFTP packet boundaries and the preview protocol."
            );
        }
        let session = remotes
            .current("smoke", Some(connection.session_id))
            .unwrap();
        let (started, received) = tokio::sync::oneshot::channel();
        let cancelling = session.clone();
        let pending = tauri::async_runtime::spawn(async move {
            let _wire = cancelling.wire.lock().await;
            let _ = cancelling
                .complete(
                    async {
                        let _ = started.send(());
                        std::future::pending::<wire::Result<()>>().await
                    },
                    60,
                )
                .await;
        });
        received.await.unwrap();
        pending.abort();
        let mut finished = session.finished.clone();
        tokio::time::timeout(Duration::from_secs(5), finished.wait_for(|done| *done))
            .await
            .unwrap()
            .unwrap();
        assert!(remotes
            .current("smoke", Some(connection.session_id))
            .is_err());
        let replacement = remotes
            .connect("smoke", &host, "", Arc::new(|_| {}))
            .await
            .unwrap();
        assert_ne!(replacement.session_id, connection.session_id);
        assert!(!remotes
            .list("smoke", "/", Some(replacement.session_id))
            .await
            .unwrap()
            .entries
            .is_empty());
        eprintln!("Cancelled read retired its session; reconnect and browsing succeeded.");
        let connection = remotes
            .current("smoke", Some(replacement.session_id))
            .unwrap();
        let (started, received) = tokio::sync::oneshot::channel();
        let active = connection.clone();
        let reading = tauri::async_runtime::spawn(async move {
            let _wire = active.wire.lock().await;
            active
                .complete(
                    async {
                        let _ = started.send(());
                        std::future::pending::<wire::Result<()>>().await
                    },
                    60,
                )
                .await
        });
        received.await.unwrap();
        remotes.disconnect("smoke").await;
        assert!(tokio::time::timeout(Duration::from_secs(5), reading)
            .await
            .unwrap()
            .unwrap()
            .is_err());
        eprintln!("Disconnect interrupted an in-flight reader.");
        if let Ok(path) = std::env::var("STRATUM_SFTP_TEST_RANGE") {
            let source = crate::services::preview_protocol::RemoteSource {
                remotes: remotes.clone(),
                profile_id: "smoke".into(),
                session_id: replacement.session_id,
                path,
                size: 1024,
                modified: None,
                cache_generation: 0,
                thumbnail: None,
            };
            let response = crate::services::preview_protocol::test_remote_response(
                source,
                Some("bytes=0-100"),
                false,
            )
            .await;
            assert_eq!(response.status(), 404);
            eprintln!("Disconnected gallery source returns unavailable.");
        }
        assert!(remotes
            .current("smoke", Some(root.session_id.wrapping_add(1)))
            .is_err());
        remotes.disconnect("smoke").await;
        assert!(remotes.current("smoke", None).is_err());
    });
}
