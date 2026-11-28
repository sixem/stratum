// Real loopback HTTP receivers exercise the production worker, encrypted settings, and restart recovery.
use super::{
    delivery::{self, Next, MAX_ATTEMPTS},
    store::{Edit, Store},
    target::Target,
    Engine,
};
use crate::services::operation_events::{
    EntryKind, ItemSuccess, Location, OperationEvents, Origin, TransferCounts, TransferOutcome,
};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use uuid::Uuid;

fn edit(url: &str) -> Edit {
    Edit {
        id: None,
        name: "Receiver".into(),
        url: Some(url.into()),
        token: Some("private-bearer".into()),
        enabled: true,
        events: ["file.created", "directory.moved", "transfer.cancelled"]
            .into_iter()
            .map(str::to_owned)
            .collect(),
    }
}
fn memory() -> Store {
    Store::open(Path::new(":memory:")).unwrap()
}
fn engine(store: Store, events: &OperationEvents) -> Engine {
    Engine::start(store, events.clone(), || {}, |_, _| {})
}
fn endpoint(listener: &TcpListener) -> String {
    format!(
        "http://{}/hidden?key=secret-query",
        listener.local_addr().unwrap()
    )
}

struct Request {
    stream: TcpStream,
    headers: String,
    body: String,
}
impl Request {
    async fn read(listener: &TcpListener) -> Self {
        tokio::time::timeout(Duration::from_secs(10), async {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut data = Vec::new();
            let mut chunk = [0u8; 2048];
            let header_end = loop {
                if let Some(i) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                    break i + 4;
                }
                let n = stream.read(&mut chunk).await.unwrap();
                assert_ne!(n, 0);
                data.extend_from_slice(&chunk[..n]);
            };
            let headers = String::from_utf8(data[..header_end].to_vec())
                .unwrap()
                .to_lowercase();
            let size = headers
                .lines()
                .find_map(|l| l.strip_prefix("content-length: "))
                .unwrap()
                .parse::<usize>()
                .unwrap();
            let have = data.len();
            data.resize(header_end + size, 0);
            stream.read_exact(&mut data[have..]).await.unwrap();
            Self {
                stream,
                headers,
                body: String::from_utf8(data[header_end..].to_vec()).unwrap(),
            }
        })
        .await
        .expect("receiver timed out waiting for webhook")
    }
    async fn respond(mut self, status: &str) {
        self.stream
            .write_all(
                format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .await
            .unwrap();
    }
    fn payload(&self) -> Value {
        serde_json::from_str(&self.body).unwrap()
    }
}

async fn until(mut condition: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !condition() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("worker did not settle");
}
fn remaining(engine: &Engine) -> u32 {
    engine
        .core
        .store()
        .unwrap()
        .conn
        .query_row("SELECT COUNT(*) FROM deliveries", [], |r| r.get(0))
        .unwrap()
}
fn claim(store: &Store) -> delivery::Attempt {
    let Next::Send(job) = store.next().unwrap() else {
        panic!("expected scheduled delivery")
    };
    job
}

#[test]
fn selected_local_and_sftp_events_reach_the_receiver_with_stable_ids() {
    tauri::async_runtime::block_on(async {
        let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let events = OperationEvents::default();
        let engine = engine(memory(), &events);
        assert!(!events.has_subscribers());
        engine
            .configure(|s| s.save(edit(&endpoint(&socket))))
            .unwrap();
        let mut observed = events.subscribe();
        let file =
            std::env::temp_dir().join(format!("stratum-webhook-résumé-{}.txt", Uuid::new_v4()));
        let local = file.as_path();
        events
            .create_entry(local.to_string_lossy().into_owned(), EntryKind::File)
            .unwrap();
        let first_event = observed.try_recv().unwrap();
        std::fs::remove_file(local).unwrap();
        let remote = Location::sftp("lab-profile", r"/out/ a\b ");
        let mut op = events.operation(Some("work-2"), Origin::User, [remote.clone()]);
        op.item_succeeded(&remote, EntryKind::Directory, || ItemSuccess::Relocated {
            destination: Location::Local(r"C:\out\tree".into()),
        });
        op.finish_transfer(
            TransferOutcome::Cancelled,
            TransferCounts {
                moved: 1,
                skipped: 2,
                ..Default::default()
            },
        );
        // This type wasn't selected.
        events.local_item(None, local, EntryKind::File, || {
            ItemSuccess::Deleted(crate::services::operation_events::DeleteMethod::Permanent)
        });
        let one = Request::read(&socket).await;
        assert!(one.headers.contains("authorization: bearer private-bearer"));
        assert!(one.headers.contains("content-type: application/json"));
        let payload = one.payload();
        assert_eq!(payload["eventId"], first_event.id.to_string());
        assert_eq!(payload["type"], "file.created");
        assert_eq!(payload["version"], 1);
        assert_eq!(payload["origin"], "user");
        assert_eq!(payload["operationId"], first_event.operation_id);
        assert!(payload["timestampMs"].as_i64().unwrap() > 0);
        assert_eq!(
            payload["details"],
            json!({"destination":{"kind":"local","path":local}})
        );
        let original = one.body.clone();
        one.respond("503 Unavailable").await;
        let two = Request::read(&socket).await;
        assert_eq!(
            two.payload()["details"],
            json!({"source":{"kind":"sftp","hostId":"lab-profile","path":r"/out/ a\b "},
            "destination":{"kind":"local","path":r"C:\out\tree"}})
        );
        assert_eq!(two.payload()["type"], "directory.moved");
        two.respond("200 OK").await;
        let three = Request::read(&socket).await;
        assert_eq!(three.payload()["type"], "transfer.cancelled");
        assert_eq!(three.payload()["operationId"], "work-2");
        assert_eq!(
            three.payload()["details"]["counts"],
            json!({"copied":0,"moved":1,"failed":0,"skipped":2})
        );
        three.respond("204 No Content").await;
        let retry = Request::read(&socket).await;
        assert_eq!(retry.body, original);
        retry.respond("200 OK").await;
        until(|| remaining(&engine) == 0).await;
        assert_eq!(engine.core.store().unwrap().work().unwrap().total, 0);
    });
}

#[test]
fn in_flight_shutdown_replays_the_payload_and_work_retries_a_permanent_failure() {
    tauri::async_runtime::block_on(async {
        let dir = std::env::temp_dir().join(Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("webhooks.sqlite");
        let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let events = OperationEvents::default();
        let first = engine(Store::open(&path).unwrap(), &events);
        let mut config = edit(&endpoint(&socket));
        config.enabled = false;
        first.configure(|s| s.save(config)).unwrap();
        assert!(!events.has_subscribers());
        let hook = first.core.store().unwrap().hooks[0].id.clone();
        first.core.store().unwrap().test_event(&hook).unwrap();
        first.core.wake.notify_one();
        let unconfirmed = Request::read(&socket).await;
        let original = unconfirmed.body.clone();
        assert_eq!(unconfirmed.payload()["type"], "webhook.test");
        first.stop();
        drop(first);
        drop(unconfirmed);
        let second = engine(Store::open(&path).unwrap(), &events);
        let replay = Request::read(&socket).await;
        assert_eq!(replay.body, original);
        replay.respond("401 Unauthorized").await;
        until(|| second.core.store().unwrap().work().unwrap().total == 1).await;
        {
            let db = second.core.store().unwrap();
            let work = serde_json::to_value(db.work().unwrap()).unwrap();
            let failure = &work["failures"][0];
            assert_eq!(failure["attempts"], 2);
            assert_eq!(failure["error"], "Receiver returned HTTP 401.");
            assert!(!work.to_string().contains("secret-query"));
            assert!(failure["canRetry"].as_bool().unwrap());
            db.retry(failure["id"].as_i64().unwrap()).unwrap();
        }
        second.core.wake.notify_one();
        let manual = Request::read(&socket).await;
        assert_eq!(manual.body, original);
        manual.respond("202 Accepted").await;
        until(|| remaining(&second) == 0).await;
        second.stop();
        drop(second);
        until(|| std::fs::remove_dir_all(&dir).is_ok()).await;
    });
}

#[test]
fn timeouts_exhaust_the_budget_and_a_last_unconfirmed_attempt_stays_failed_on_restart() {
    tauri::async_runtime::block_on(async {
        let path: PathBuf =
            std::env::temp_dir().join(format!("webhooks-{}.sqlite", Uuid::new_v4()));
        let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut db = Store::open(&path).unwrap();
        db.save(edit(&endpoint(&socket))).unwrap();
        db.test_event(&db.hooks[0].id).unwrap();
        let client = delivery::client(Duration::from_millis(150)).unwrap();
        for n in 1..=MAX_ATTEMPTS {
            let job = claim(&db);
            let result = delivery::send(&client, &job).await;
            assert_eq!(result.as_ref().err().unwrap().message, "Request timed out.");
            assert_eq!(db.settle(&job, &result).unwrap(), n == MAX_ATTEMPTS);
            if n < MAX_ATTEMPTS {
                assert!(matches!(db.next().unwrap(), Next::Wait(Some(_))));
            }
            db.conn.execute("UPDATE deliveries SET due=0", []).unwrap();
        }
        let work = serde_json::to_value(db.work().unwrap()).unwrap();
        assert_eq!(work["failures"][0]["attempts"], MAX_ATTEMPTS);
        db.conn
            .execute("UPDATE deliveries SET state='sending'", [])
            .unwrap();
        drop(db);
        let db = Store::open(&path).unwrap();
        assert_eq!(db.work().unwrap().total, 1);
        assert!(matches!(db.next().unwrap(), Next::Wait(None)));
        drop(db);
        std::fs::remove_file(path).unwrap();
    });
}

#[test]
fn credentials_stay_protected_and_endpoint_changes_never_redirect_queued_data() {
    let mut db = memory();
    let url = "https://example.com/secret-path?key=secret-query";
    db.save(edit(url)).unwrap();
    let hook = &db.hooks[0];
    let id = hook.id.clone();
    let ui = serde_json::to_string(hook).unwrap();
    let sealed: Vec<u8> = db
        .conn
        .query_row("SELECT target FROM hooks", [], |r| r.get(0))
        .unwrap();
    for secret in ["secret-path", "secret-query", "private-bearer"] {
        assert!(!ui.contains(secret));
        assert!(!sealed.windows(secret.len()).any(|w| w == secret.as_bytes()));
    }
    assert_eq!(Target::open(&sealed).unwrap().url, url);
    db.test_event(&id).unwrap();
    let mut changed = edit("https://example.org/different");
    changed.id = Some(id.clone());
    changed.token = None;
    db.save(changed).unwrap();
    assert!(!db.hooks[0].has_token);
    let job = claim(&db);
    tauri::async_runtime::block_on(async {
        let result = delivery::send(&delivery::client(Duration::from_secs(1)).unwrap(), &job).await;
        assert!(result.is_err());
        db.settle(&job, &result).unwrap();
    });
    assert!(!db.work().unwrap().failures[0].can_retry);
    assert!(db.retry(job.id).is_err());
    let mut restored = edit(url);
    restored.id = Some(id.clone());
    db.save(restored).unwrap();
    assert!(db.work().unwrap().failures[0].can_retry);
    db.retry(job.id).unwrap();
    db.capture(&[], 17).unwrap();
    assert_eq!(db.work().unwrap().missed, 17);
    db.dismiss(None).unwrap();
    db.remove(&id).unwrap();
    assert!(matches!(db.next().unwrap(), Next::Wait(None)));
    for url in [
        "http://example.com/path",
        "https://user:password@example.com",
        "file:///C:/x",
        "https://example.com/#fragment",
    ] {
        assert!(db.save(edit(url)).is_err());
    }
}

#[test]
fn one_event_fans_out_by_subscription_and_paused_deliveries_resume() {
    let mut db = memory();
    db.save(edit("https://one.example/in")).unwrap();
    db.save(edit("https://two.example/in")).unwrap();
    let mut filtered = edit("https://three.example/in");
    filtered.events = vec!["file.deleted".into()];
    db.save(filtered).unwrap();
    let hooks = db.hooks.clone();
    let events = OperationEvents::default();
    let mut receiver = events.subscribe();
    let path = Path::new(r"C:\work\entry.txt");
    events.local_item(None, path, EntryKind::File, || ItemSuccess::Created {
        destination: Location::Local(path.into()),
    });
    let selected = receiver.try_recv().unwrap();
    db.capture(&[selected.clone()], 0).unwrap();
    let pause = |enabled| Edit {
        id: Some(hooks[0].id.clone()),
        name: hooks[0].name.clone(),
        enabled,
        events: hooks[0].events.clone(),
        url: None,
        token: None,
    };
    db.save(pause(false)).unwrap();
    let active = claim(&db);
    assert_eq!(active.hook, hooks[1].id);
    db.settle(&active, &Ok(())).unwrap();
    assert!(matches!(db.next().unwrap(), Next::Wait(None)));
    db.save(pause(true)).unwrap();
    let resumed = claim(&db);
    assert_eq!(resumed.hook, hooks[0].id);
    assert_eq!(resumed.body, active.body);
    assert_eq!(
        serde_json::from_str::<Value>(&resumed.body).unwrap()["eventId"],
        selected.id.to_string()
    );
    db.settle(&resumed, &Ok(())).unwrap();
    assert!(matches!(db.next().unwrap(), Next::Wait(None)));
}

#[test]
fn pausing_drains_events_emitted_before_the_change() {
    tauri::async_runtime::block_on(async {
        let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let events = OperationEvents::default();
        let engine = engine(memory(), &events);
        engine
            .configure(|db| db.save(edit(&endpoint(&socket))))
            .unwrap();
        let hook = engine.core.store().unwrap().hooks[0].clone();
        let path = Path::new(r"C:\work\before-pause.txt");
        // Hold the store lock so capture cannot commit before the pause.
        engine
            .configure(|db| {
                events.local_item(None, path, EntryKind::File, || ItemSuccess::Created {
                    destination: Location::Local(path.into()),
                });
                db.save(Edit {
                    id: Some(hook.id.clone()),
                    name: hook.name.clone(),
                    enabled: false,
                    events: hook.events.clone(),
                    url: None,
                    token: None,
                })
            })
            .unwrap();
        until(|| remaining(&engine) == 1 && !events.has_subscribers()).await;
        assert!(
            tokio::time::timeout(Duration::from_millis(100), socket.accept())
                .await
                .is_err()
        );
        engine
            .configure(|db| {
                db.save(Edit {
                    id: Some(hook.id.clone()),
                    name: hook.name.clone(),
                    enabled: true,
                    events: hook.events.clone(),
                    url: None,
                    token: None,
                })
            })
            .unwrap();
        let request = Request::read(&socket).await;
        assert_eq!(
            request.payload()["details"]["destination"]["path"],
            path.to_string_lossy().as_ref()
        );
        request.respond("200 OK").await;
        until(|| remaining(&engine) == 0).await;
    });
}

#[test]
fn delayed_events_keep_their_original_filter_and_destination() {
    let mut db = memory();
    let old_url = "https://one.example/private";
    db.save(edit(old_url)).unwrap();
    let id = db.hooks[0].id.clone();
    let events = OperationEvents::default();
    let mut receiver = events.subscribe();
    let path = Path::new(r"C:\work\before-edit.txt");
    events.local_item(None, path, EntryKind::File, || ItemSuccess::Created {
        destination: Location::Local(path.into()),
    });
    let old = receiver.try_recv().unwrap();
    let mut changed = edit("https://two.example/private");
    changed.id = Some(id.clone());
    changed.events = vec!["file.deleted".into()];
    db.save(changed).unwrap();
    events.local_item(None, path, EntryKind::File, || ItemSuccess::Created {
        destination: Location::Local(path.into()),
    });
    let after_edit = receiver.try_recv().unwrap();
    db.capture(&[old, after_edit], 0).unwrap();
    let job = claim(&db);
    tauri::async_runtime::block_on(async {
        let result = delivery::send(&delivery::client(Duration::from_secs(1)).unwrap(), &job).await;
        assert!(result.is_err());
        db.settle(&job, &result).unwrap();
    });
    let work = db.work().unwrap();
    assert_eq!(work.total, 1);
    assert!(!work.failures[0].can_retry);
    let mut restored = edit(old_url);
    restored.id = Some(id);
    db.save(restored).unwrap();
    assert!(db.work().unwrap().failures[0].can_retry);
    db.retry(job.id).unwrap();
}

#[test]
fn redirects_fail_in_work_without_forwarding_the_request_or_its_token() {
    tauri::async_runtime::block_on(async {
        let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let other = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut db = memory();
        db.save(edit(&endpoint(&socket))).unwrap();
        db.test_event(&db.hooks[0].id).unwrap();
        let job = claim(&db);
        let client = delivery::client(Duration::from_secs(2)).unwrap();
        let destination = endpoint(&other);
        let (result, ()) = tokio::join!(delivery::send(&client, &job), async {
            let mut request = Request::read(&socket).await;
            request.stream.write_all(format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: {destination}\r\nContent-Length: 0\r\n\r\n").as_bytes()).await.unwrap();
        });
        assert!(db.settle(&job, &result).unwrap());
        assert_eq!(db.work().unwrap().total, 1);
        assert!(
            tokio::time::timeout(Duration::from_millis(50), other.accept())
                .await
                .is_err()
        );
    });
}

// Called by the disposable SFTP fixture around its real, verified create command.
pub(crate) async fn check_sftp_creation(
    events: &OperationEvents,
    host: &str,
    path: &str,
    create: impl std::future::Future<Output = Result<(), String>>,
) {
    let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut store = memory();
    store.save(edit(&endpoint(&socket))).unwrap();
    let worker = engine(store, events);
    create.await.unwrap();
    let received = Request::read(&socket).await;
    let payload = received.payload();
    assert_eq!(payload["type"], "file.created");
    assert_eq!(
        payload["details"]["destination"],
        json!({"kind":"sftp","hostId":host,"path":path})
    );
    received.respond("204 No Content").await;
    until(|| remaining(&worker) == 0).await;
}
