// Durable records for remote deletions that may be interrupted after staging.
use super::{
    operations::{recover_delete_stage, SelectedEntry},
    recovery::{ActiveMove, RecoveryJournal},
    Remotes,
};
use rusqlite::params;

#[derive(Clone)]
pub(super) struct DeleteStage {
    pub id: String,
    pub host: String,
    pub original: String,
    pub stage: String,
    pub selected: SelectedEntry,
    pub deleting: bool,
    pub restored_partial: bool,
}

impl RecoveryJournal {
    pub(super) fn insert_delete(&self, item: &DeleteStage) -> Result<(), String> {
        let selected = serde_json::to_string(&item.selected).map_err(|e| e.to_string())?;
        self.open()?
            .execute(
                "INSERT INTO remote_deletes VALUES (?1, ?2, ?3, ?4, ?5, 'staged')",
                params![item.id, item.host, item.original, item.stage, selected],
            )
            .map_err(|e| format!("Could not save delete recovery: {e}"))?;
        Ok(())
    }

    pub(super) fn mark_delete_started(&self, id: &str) -> Result<(), String> {
        let changed = self
            .open()?
            .execute(
                "UPDATE remote_deletes SET state='deleting' WHERE id=?1",
                [id],
            )
            .map_err(|e| format!("Could not update delete recovery: {e}"))?;
        if changed != 1 {
            return Err("Delete recovery record is missing.".into());
        }
        Ok(())
    }

    pub(super) fn remove_delete(&self, id: &str) -> Result<(), String> {
        self.open()?
            .execute("DELETE FROM remote_deletes WHERE id=?1", [id])
            .map_err(|e| format!("Could not clear delete recovery: {e}"))?;
        Ok(())
    }

    pub(super) fn mark_delete_restored_partial(&self, id: &str) -> Result<(), String> {
        let changed = self
            .open()?
            .execute(
                "UPDATE remote_deletes SET state='restored_partial' WHERE id=?1",
                [id],
            )
            .map_err(|e| format!("Could not save delete recovery notice: {e}"))?;
        if changed != 1 {
            return Err("Delete recovery record is missing.".into());
        }
        Ok(())
    }

    pub(super) fn acknowledge_delete_notices(
        &self,
        host: &str,
        ids: &[String],
    ) -> Result<(), String> {
        let mut db = self.open()?;
        let transaction = db.transaction().map_err(|e| e.to_string())?;
        for id in ids {
            transaction.execute("DELETE FROM remote_deletes WHERE id=?1 AND host=?2 AND state='restored_partial'", params![id, host])
                .map_err(|e| format!("Could not acknowledge delete recovery: {e}"))?;
        }
        transaction.commit().map_err(|e| e.to_string())
    }

    fn deletes_for_host(&self, host: &str) -> Result<Vec<DeleteStage>, String> {
        let db = self.open()?;
        let mut query = db.prepare("SELECT id, host, original, stage, selected, state FROM remote_deletes WHERE host=?1 ORDER BY rowid")
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([host], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.map(|row| {
            let (id, host, original, stage, selected, state) = row.map_err(|e| e.to_string())?;
            if state != "staged" && state != "deleting" && state != "restored_partial" {
                return Err("Invalid delete recovery state.".into());
            }
            Ok(DeleteStage {
                id,
                host,
                original,
                stage,
                selected: serde_json::from_str(&selected)
                    .map_err(|e| format!("Invalid delete recovery record: {e}"))?,
                deleting: state == "deleting",
                restored_partial: state == "restored_partial",
            })
        })
        .collect()
    }
}

// Never continue deleting on reconnect. Restore the surviving item if it is safe
// to do so, and clearly warn when deletion may already have removed children.
pub(super) async fn recover_interrupted_deletes(
    remotes: &Remotes,
    journal: &RecoveryJournal,
    host: &str,
    profile: &str,
    session: u32,
    restored: &mut Vec<String>,
    warnings: &mut Vec<String>,
    notices: &mut Vec<String>,
) -> Result<(), String> {
    for entry in journal.deletes_for_host(host)? {
        let Ok(_active) = ActiveMove::start(&entry.id) else {
            continue;
        };
        if entry.restored_partial {
            warnings.push(format!("Deletion of {} was interrupted. Check the original location; some contents may already have been deleted.", entry.original));
            notices.push(entry.id);
            continue;
        }
        match recover_delete_stage(remotes, profile, session, &entry).await {
            Ok(was_restored) => {
                if was_restored {
                    restored.push(entry.original.clone());
                }
                if entry.deleting {
                    journal.mark_delete_restored_partial(&entry.id)?;
                    notices.push(entry.id.clone());
                    warnings.push(format!("Deletion of {} was interrupted. Check the original location; some contents may already have been deleted.", entry.original));
                } else {
                    journal.remove_delete(&entry.id)?;
                }
            }
            Err(error) => warnings.push(format!(
                "Interrupted deletion of {}: {error} Check {}/item on {}.",
                entry.original, entry.stage, entry.host
            )),
        }
    }
    Ok(())
}

// Only an explicit acknowledgement may retire a notice, and only for this host.
#[tauri::command]
pub(crate) async fn remote_acknowledge_delete_recovery(
    webview: tauri::Webview,
    profile_id: String,
    session_id: u32,
    ids: Vec<String>,
) -> Result<(), String> {
    if ids.len() > 100_000 {
        return Err("Too many recovery notices.".into());
    }
    let remotes = super::manager(&webview)?;
    let session = remotes.current(&profile_id, Some(session_id))?;
    RecoveryJournal::for_webview(&webview)?.acknowledge_delete_notices(&session.host, &ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delete_records_survive_reopen_and_remain_scoped_to_the_host() {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let path = std::env::temp_dir().join(format!(
            "stratum-delete-journal-{:032x}.sqlite",
            u128::from_le_bytes(random)
        ));
        let journal = RecoveryJournal::for_test(path.clone());
        let selected: SelectedEntry = serde_json::from_value(serde_json::json!({
            "name": "folder", "isDir": true, "isSymlink": false, "size": null, "modified": null
        }))
        .unwrap();
        let entry = DeleteStage {
            id: "0123456789abcdef0123456789abcdef".into(),
            host: "host-a".into(),
            original: "/data/folder".into(),
            stage: "/data/.stratum-delete-0123456789abcdef0123456789abcdef".into(),
            selected,
            deleting: false,
            restored_partial: false,
        };
        journal.insert_delete(&entry).unwrap();
        assert!(journal.deletes_for_host("host-b").unwrap().is_empty());
        assert!(!journal.deletes_for_host("host-a").unwrap()[0].deleting);
        journal.mark_delete_started(&entry.id).unwrap();
        let reopened = RecoveryJournal::for_test(path.clone());
        let pending = reopened.deletes_for_host("host-a").unwrap();
        assert_eq!(pending.len(), 1);
        assert!(pending[0].deleting);
        assert_eq!(pending[0].original, entry.original);
        reopened.remove_delete(&entry.id).unwrap();
        assert!(reopened.deletes_for_host("host-a").unwrap().is_empty());
        std::fs::remove_file(path).unwrap();
    }
}
