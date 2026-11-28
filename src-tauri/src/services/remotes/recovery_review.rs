// Work reads the operational journal, including records created by older versions.
// Acknowledging a notice changes only the journal and never touches either filesystem.
use super::{
    manager,
    recovery::{active_moves, ActiveMove, RecoveryJournal},
};
use rusqlite::params;
use serde::Serialize;
use tauri::Webview;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryDetail {
    id: String,
    kind: String,
    host: String,
    original: Option<String>,
    source_host: Option<String>,
    location: String,
    state: String,
}

impl RecoveryJournal {
    fn details(&self) -> Result<Vec<RecoveryDetail>, String> {
        let db = self.open()?;
        let mut query = db.prepare("
            SELECT id, 'delete', host, original, host,
                CASE WHEN state='restored_partial' THEN original ELSE stage || '/item' END, state FROM remote_deletes
                WHERE NOT EXISTS (SELECT 1 FROM reviewed_deletes r WHERE r.id=remote_deletes.id AND r.state=remote_deletes.state)
            UNION ALL SELECT id, 'move', host, original, host,
                CASE WHEN state='restored_partial' THEN original ELSE stage END, state FROM moves
                WHERE NOT EXISTS (SELECT 1 FROM reviewed_moves r WHERE r.id=moves.id AND r.state=moves.state)
            UNION ALL SELECT d.id, 'destination', d.host, COALESCE(s.original, m.original),
                COALESCE(s.host, m.host), d.path, 'remaining' FROM destination_stages d
                LEFT JOIN destination_sources s ON s.id=d.id LEFT JOIN moves m ON m.id=d.id
            ORDER BY 3, 4, 2, 1").map_err(|e| e.to_string())?;
        let active = active_moves()
            .lock()
            .map_err(|_| "Recovery journal unavailable.")?;
        let mut details = Vec::new();
        let rows = query
            .query_map([], |row| {
                Ok(RecoveryDetail {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    host: row.get(2)?,
                    original: row.get(3)?,
                    source_host: row.get(4)?,
                    location: row.get(5)?,
                    state: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for detail in rows {
            let detail = detail.map_err(|e| e.to_string())?;
            if !active.contains(&detail.id) {
                details.push(detail);
            }
        }
        Ok(details)
    }

    pub(super) fn reviewed_source(
        &self,
        kind: &str,
        id: &str,
        state: &str,
    ) -> Result<bool, String> {
        let (_, reviews) = source_tables(kind)?;
        self.open()?
            .query_row(
                &format!("SELECT EXISTS(SELECT 1 FROM {reviews} WHERE id=?1 AND state=?2)"),
                params![id, state],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())
    }

    fn acknowledge(&self, kind: &str, id: &str, host: &str, state: &str) -> Result<(), String> {
        let _guard = ActiveMove::start(id)?;
        let db = self.open()?;
        let changed = if kind == "destination" && state == "remaining" {
            db.execute(
                "DELETE FROM destination_stages WHERE id=?1 AND host=?2",
                params![id, host],
            )
        } else {
            let (source, reviews) = source_tables(kind)?;
            if state == "restored_partial" {
                db.execute(
                    &format!("DELETE FROM {source} WHERE id=?1 AND host=?2 AND state=?3"),
                    params![id, host, state],
                )
            } else {
                // Hide only the reviewed state. Keep retrying safe restoration on reconnect.
                db.execute(
                    &format!(
                        "INSERT OR REPLACE INTO {reviews} (id, state)
                    SELECT id, state FROM {source} WHERE id=?1 AND host=?2 AND state=?3"
                    ),
                    params![id, host, state],
                )
            }
        }
        .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("This recovery record changed. Review the current details.".into());
        }
        Ok(())
    }
}

fn source_tables(kind: &str) -> Result<(&'static str, &'static str), String> {
    match kind {
        "move" => Ok(("moves", "reviewed_moves")),
        "delete" => Ok(("remote_deletes", "reviewed_deletes")),
        _ => Err("Unknown recovery notice.".into()),
    }
}

#[tauri::command]
pub(crate) async fn remote_recovery_details(
    webview: Webview,
) -> Result<Vec<RecoveryDetail>, String> {
    manager(&webview)?;
    RecoveryJournal::for_webview(&webview)?.details()
}

#[tauri::command]
pub(crate) async fn remote_recovery_acknowledge(
    webview: Webview,
    kind: String,
    id: String,
    host: String,
    state: String,
) -> Result<(), String> {
    manager(&webview)?;
    RecoveryJournal::for_webview(&webview)?.acknowledge(&kind, &id, &host, &state)
}

#[cfg(test)]
mod tests {
    use super::super::recovery::{DestinationStage, RecoveryEntry};
    use super::*;

    #[test]
    fn delete_review_tracks_the_remaining_location_until_explicit_acknowledgement() {
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).unwrap();
        let id = format!("{:032x}", u128::from_le_bytes(bytes));
        let root = std::env::temp_dir().join(&id);
        let path = root.join("review.sqlite");
        let journal = RecoveryJournal::for_test(path.clone());
        let selected = serde_json::from_value(serde_json::json!({
            "name": "folder", "isDir": true, "isSymlink": false, "size": null, "modified": null
        }))
        .unwrap();
        journal
            .insert_delete(&super::super::delete_recovery::DeleteStage {
                id: id.clone(),
                host: "a".into(),
                original: "/folder".into(),
                stage: "/stage".into(),
                selected,
                deleting: false,
                restored_partial: false,
            })
            .unwrap();
        journal.mark_delete_started(&id).unwrap();
        let reopened = RecoveryJournal::for_test(path);
        let detail = reopened.details().unwrap().pop().unwrap();
        assert_eq!(
            (detail.state.as_str(), detail.location.as_str()),
            ("deleting", "/stage/item")
        );
        assert!(reopened.acknowledge("delete", &id, "a", "staged").is_err());
        reopened
            .acknowledge("delete", &id, "a", "deleting")
            .unwrap();
        assert!(journal.details().unwrap().is_empty());
        assert!(journal.reviewed_source("delete", &id, "deleting").unwrap());
        reopened.mark_delete_restored_partial(&id).unwrap();
        assert_eq!(journal.details().unwrap()[0].location, "/folder");
        assert!(journal
            .acknowledge("delete", &id, "other", "restored_partial")
            .is_err());
        journal
            .acknowledge("delete", &id, "a", "restored_partial")
            .unwrap();
        assert!(reopened.details().unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn work_reopens_offline_and_acknowledgement_protects_originals_and_remaining_data() {
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).unwrap();
        let id = format!("{:032x}", u128::from_le_bytes(bytes));
        let root = std::env::temp_dir().join(&id);
        let journal = RecoveryJournal::for_test(root.join("review.sqlite"));
        let entry = RecoveryEntry {
            id: id.clone(),
            profile: "source".into(),
            host: "a".into(),
            original: "/doc".into(),
            stage: "/stage/doc".into(),
            destination: "/out".into(),
            state: "published".into(),
        };
        journal.insert(&entry).unwrap();
        let path = root.join("remaining");
        std::fs::write(&path, b"keep").unwrap();
        journal
            .track_destination(
                &DestinationStage {
                    id: id.clone(),
                    kind: "local".into(),
                    host: String::new(),
                    folder: root.display().to_string(),
                    path: path.display().to_string(),
                    identity: None,
                },
                "a",
                "/doc",
            )
            .unwrap();
        let guard = ActiveMove::start(&id).unwrap();
        assert!(journal.details().unwrap().is_empty());
        drop(guard);
        let reopened = RecoveryJournal::for_test(root.join("review.sqlite"));
        let rows = reopened.details().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(
            |r| r.source_host.as_deref() == Some("a") && r.original.as_deref() == Some("/doc")
        ));
        reopened.acknowledge("move", &id, "a", "published").unwrap();
        assert_eq!(journal.details().unwrap().len(), 1);
        assert_eq!(journal.list().unwrap()[0].stage, "/stage/doc");
        reopened.state(&id, "restored_partial").unwrap();
        assert!(reopened
            .acknowledge("move", &id, "b", "restored_partial")
            .is_err());
        assert_eq!(
            reopened
                .details()
                .unwrap()
                .iter()
                .find(|r| r.kind == "move")
                .unwrap()
                .location,
            "/doc"
        );
        reopened
            .acknowledge("move", &id, "a", "restored_partial")
            .unwrap();
        reopened
            .acknowledge("destination", &id, "", "remaining")
            .unwrap();
        assert!(journal.details().unwrap().is_empty());
        assert_eq!(std::fs::read(&path).unwrap(), b"keep");
        std::fs::remove_dir_all(root).unwrap();
    }
}
