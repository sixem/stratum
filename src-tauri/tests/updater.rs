// A fixture signed by an ephemeral test key. The only payload served is plain text.
use serde_json::json;
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    time::Duration,
};
use tauri_plugin_updater::UpdaterExt;

const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDcxQTcwQzExNjcyQUE1MUUKUldRZXBTcG5FUXluY1hma1M0RjFYeDluS1lhMGRlVnlrOWthNkR5azBoSStPK2V3ODlnOEVjeTQK";
const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRZXBTcG5FUXluY1k4cDJMUFdiSU5wODBTNlB5ZjBRMVAvTkxHVUFLZm9LL29wZFhiS1gvUEVEM2ZucW5VVFRudTlGNVBMZ0RBUVROQ1FXT0tUWVBKM1ZPTHhrMXJGVkFBPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1NjUzOTU4CWZpbGU6U3RyYXR1bV8wLjIuNV94NjQtc2V0dXAuZXhlCXZlcnNpb246MC4yLjUKVDd1VktMS1VIVFhMRmNKYTFLZ1RmZzRwNkRjc1JvT2ZXY0FtOUY0b2hCYlJMTENzVVdrUFg1bTdrZUpkRjJHT2E2ekwvc0o4U3ozTkdDdkJoQ1pmQ2c9PQo=";
const PAYLOAD: &str = "only a fixture, never install\n";

#[test]
fn signed_update_accepts_genuine_bytes_and_rejects_tampering_relabelling_and_withdrawal() {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", server.local_addr().unwrap());
    let manifest = |version| {
        json!({
            "version": version, "pub_date": "2026-11-20T00:00:00Z",
            "platforms": { "windows-x86_64": {
                "signature": SIGNATURE, "url": format!("{origin}/setup.exe")
            }}
        })
        .to_string()
    };
    let responses = [
        ("stable.json", manifest("0.2.5")),
        ("setup.exe", PAYLOAD.to_owned()),
        ("setup.exe", "altered bytes".to_owned()),
        ("stable.json", manifest("0.2.6")),
        ("setup.exe", PAYLOAD.to_owned()),
        ("stable.json", String::new()),
    ];
    let thread = std::thread::spawn(move || {
        for (path, body) in responses {
            let (mut stream, _) = server.accept().unwrap();
            let mut reader = BufReader::new(&stream);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert!(line.starts_with(&format!("GET /{path} ")));
            while line != "\r\n" {
                line.clear();
                assert!(reader.read_line(&mut line).unwrap() > 0);
            }
            let status = if body.is_empty() {
                "404 Not Found"
            } else {
                "200 OK"
            };
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        }
    });
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    let release: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let mut config = release["plugins"]["updater"].clone();
    assert_eq!(config["requireSignedVersion"], true);
    config["pubkey"] = json!(PUBLIC_KEY);
    config["dangerousInsecureTransportProtocol"] = json!(true);
    config["endpoints"] = json!([format!("{origin}/stable.json")]);
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".into(), config);
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let updater = app
        .updater_builder()
        .target("windows-x86_64")
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    tauri::async_runtime::block_on(async {
        let release = updater.check().await.unwrap().unwrap();
        assert_eq!(
            release.download(|_, _| {}, || {}).await.unwrap(),
            PAYLOAD.as_bytes()
        );
        assert!(release.download(|_, _| {}, || {}).await.is_err());
        let relabelled = updater.check().await.unwrap().unwrap();
        assert!(relabelled.download(|_, _| {}, || {}).await.is_err());
        assert!(updater.check().await.is_err());
    });
    thread.join().unwrap();
}
