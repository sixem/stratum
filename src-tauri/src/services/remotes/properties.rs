// Inspect the selected directory entry itself, including links with missing targets.
use super::{
    browse::check_path,
    manager,
    wire::{Error, Fields, Reply, Request, Result, Wire},
};
use serde::Serialize;
use tauri::Webview;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Properties {
    // SFTP sizes are unsigned 64-bit values, including values above JavaScript's safe integer limit.
    size: Option<String>,
    modified: Option<u64>,
    permissions: Option<u32>,
    is_symlink: bool,
    link_target: Option<String>,
}

async fn inspect(wire: &mut Wire, path: &str) -> Result<Properties> {
    let packet = wire
        .path_request(Request::Lstat, path.as_bytes(), Reply::Attrs)
        .await?;
    let attrs = Fields(&packet).attrs()?;
    let is_symlink = attrs.kind() == 0o120000;
    let link_target = if is_symlink {
        match wire
            .path_request(Request::Readlink, path.as_bytes(), Reply::Name)
            .await
        {
            Ok(packet) => {
                let mut fields = Fields(&packet);
                if fields.number()? != 1 {
                    return Err(Error::Transport(
                        "Invalid SFTP link target response.".into(),
                    ));
                }
                std::str::from_utf8(fields.string()?)
                    .ok()
                    .map(str::to_owned)
            }
            // Some servers allow lstat but decline readlink. The other fields remain useful.
            Err(Error::Request(_) | Error::NotFound | Error::Eof) => None,
            Err(error) => return Err(error),
        }
    } else {
        None
    };
    Ok(Properties {
        size: attrs.size.map(|size| size.to_string()),
        modified: attrs.modified,
        permissions: attrs.mode.map(|mode| mode & 0o7777),
        is_symlink,
        link_target,
    })
}

#[tauri::command]
pub(crate) async fn remote_properties(
    webview: Webview,
    profile_id: String,
    session_id: u32,
    path: String,
) -> std::result::Result<Properties, String> {
    check_path(&path, false).map_err(|error| error.message().to_owned())?;
    let session = manager(&webview)?.current(&profile_id, Some(session_id))?;
    let mut wire = session.wire.lock().await;
    session.complete(inspect(&mut wire, &path), 20).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absent_permissions_and_explicit_zero_are_distinct() {
        let absent = Fields(&[0; 4]).attrs().ok().unwrap();
        let zero = Fields(&[0, 0, 0, 4, 0, 0, 0, 0]).attrs().ok().unwrap();
        assert_eq!(absent.mode, None);
        assert_eq!(zero.mode, Some(0));
    }

    #[test]
    #[ignore = "requires the disposable SFTP properties fixture"]
    fn reads_file_metadata_and_literal_target_of_a_dangling_link() {
        tauri::async_runtime::block_on(async {
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let directory = std::env::var("STRATUM_SFTP_TEST_FOLDER").unwrap();
            let remotes = super::super::Remotes::default();
            let connection = remotes
                .connect("properties", &host, "", std::sync::Arc::new(|_| {}))
                .await
                .unwrap();
            let session = remotes
                .current("properties", Some(connection.session_id))
                .unwrap();
            let mut wire = session.wire.lock().await;
            let file = session
                .complete(
                    inspect(&mut wire, &format!("{directory}/../properties/file")),
                    20,
                )
                .await
                .unwrap();
            assert_eq!(file.size.as_deref(), Some("4"));
            assert!(file.modified.is_some() && file.permissions.is_some() && !file.is_symlink);
            let link = session
                .complete(
                    inspect(&mut wire, &format!("{directory}/../properties/link")),
                    20,
                )
                .await
                .unwrap();
            assert!(link.is_symlink);
            assert_eq!(link.link_target.as_deref(), Some("missing target"));
        });
    }
}
