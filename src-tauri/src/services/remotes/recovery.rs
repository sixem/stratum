// Durable records for remote originals retained during cross-boundary moves.
// The record is committed before any remote namespace change.
use super::{browse::check_path, manager, Remotes};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{Manager, Webview};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryEntry {
    pub id: String,
    pub profile: String,
    pub host: String,
    pub original: String,
    pub stage: String,
    pub destination: String,
    pub state: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DestinationStage {
    pub id: String,
    pub kind: String,
    pub host: String,
    pub folder: String,
    pub path: String,
    pub identity: Option<String>,
}

#[derive(Clone)]
pub(crate) struct RecoveryJournal(PathBuf);

pub(super) fn active_moves() -> &'static Mutex<HashSet<String>> {
    static ACTIVE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashSet::new()))
}
pub(crate) struct ActiveMove(String);
impl ActiveMove {
    pub(crate) fn start(id: &str) -> Result<Self, String> {
        let mut active = active_moves()
            .lock()
            .map_err(|_| "Move recovery is unavailable.")?;
        if !active.insert(id.into()) {
            return Err("This move is already active.".into());
        }
        Ok(Self(id.into()))
    }
}
impl Drop for ActiveMove {
    fn drop(&mut self) {
        if let Ok(mut active) = active_moves().lock() {
            active.remove(&self.0);
        }
    }
}

impl RecoveryJournal {
    #[cfg(test)]
    pub(crate) fn for_test(path: PathBuf) -> Self { Self(path) }

    pub(crate) fn for_webview(webview: &Webview) -> Result<Self, String> {
        let directory = webview
            .app_handle()
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("Could not locate move recovery: {e}"))?;
        Ok(Self(directory.join("remote-move-recovery.sqlite")))
    }

    pub(super) fn open(&self) -> Result<Connection, String> {
        fs::create_dir_all(self.0.parent().ok_or("Invalid recovery path.")?)
            .map_err(|e| format!("Could not create move recovery folder: {e}"))?;
        let db =
            Connection::open(&self.0).map_err(|e| format!("Could not open move recovery: {e}"))?;
        db.busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS moves (
            id TEXT PRIMARY KEY, profile TEXT NOT NULL, host TEXT NOT NULL,
            original TEXT NOT NULL, stage TEXT NOT NULL, destination TEXT NOT NULL, state TEXT NOT NULL
        ); CREATE TABLE IF NOT EXISTS destination_stages (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, host TEXT NOT NULL, folder TEXT NOT NULL,
            path TEXT NOT NULL, identity TEXT
        ); CREATE TABLE IF NOT EXISTS destination_sources (
            id TEXT PRIMARY KEY REFERENCES destination_stages(id) ON DELETE CASCADE,
            host TEXT NOT NULL, original TEXT NOT NULL
        ); CREATE TABLE IF NOT EXISTS remote_deletes (
            id TEXT PRIMARY KEY, host TEXT NOT NULL, original TEXT NOT NULL,
            stage TEXT NOT NULL, selected TEXT NOT NULL, state TEXT NOT NULL
        ); CREATE TABLE IF NOT EXISTS reviewed_moves (
            id TEXT PRIMARY KEY REFERENCES moves(id) ON DELETE CASCADE, state TEXT NOT NULL
        ); CREATE TABLE IF NOT EXISTS reviewed_deletes (
            id TEXT PRIMARY KEY REFERENCES remote_deletes(id) ON DELETE CASCADE, state TEXT NOT NULL
        );").map_err(|e| format!("Could not prepare move recovery: {e}"))?;
        Ok(db)
    }

    pub(crate) fn insert(&self, item: &RecoveryEntry) -> Result<(), String> {
        self.open()?
            .execute(
                "INSERT INTO moves VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    item.id,
                    item.profile,
                    item.host,
                    item.original,
                    item.stage,
                    item.destination,
                    item.state
                ],
            )
            .map_err(|e| format!("Could not save move recovery: {e}"))?;
        Ok(())
    }

    pub(crate) fn state(&self, id: &str, state: &str) -> Result<(), String> {
        self.open()?
            .execute("UPDATE moves SET state=?2 WHERE id=?1", params![id, state])
            .map_err(|e| format!("Could not update move recovery: {e}"))?;
        Ok(())
    }

    pub(crate) fn track_destination(
        &self,
        stage: &DestinationStage,
        source_host: &str,
        original: &str,
    ) -> Result<(), String> {
        let mut db = self.open()?;
        let transaction = db.transaction().map_err(|e| e.to_string())?;
        transaction
            .execute(
                "INSERT INTO destination_stages VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    stage.id,
                    stage.kind,
                    stage.host,
                    stage.folder,
                    stage.path,
                    stage.identity
                ],
            )
            .map_err(|e| format!("Could not save destination recovery: {e}"))?;
        transaction
            .execute(
                "INSERT INTO destination_sources VALUES (?1, ?2, ?3)",
                params![stage.id, source_host, original],
            )
            .map_err(|e| format!("Could not save the source location: {e}"))?;
        transaction.commit().map_err(|e| e.to_string())
    }

    pub(crate) fn destination_identity(&self, id: &str, identity: &str) -> Result<(), String> {
        self.open()?
            .execute(
                "UPDATE destination_stages SET identity=?2 WHERE id=?1",
                params![id, identity],
            )
            .map_err(|e| format!("Could not save destination identity: {e}"))?;
        Ok(())
    }

    pub(crate) fn clear_destination(&self, id: &str) -> Result<(), String> {
        self.open()?
            .execute("DELETE FROM destination_stages WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(super) fn destination_stages(&self) -> Result<Vec<DestinationStage>, String> {
        let db = self.open()?;
        let mut query = db.prepare("SELECT id, kind, host, folder, path, identity FROM destination_stages ORDER BY rowid DESC").map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |row| {
                Ok(DestinationStage {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    host: row.get(2)?,
                    folder: row.get(3)?,
                    path: row.get(4)?,
                    identity: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn destination_stage(&self, id: &str) -> Result<DestinationStage, String> {
        self.destination_stages()?
            .into_iter()
            .find(|item| item.id == id)
            .ok_or("Destination staging record not found.".into())
    }

    pub(super) fn remove(&self, id: &str) -> Result<(), String> {
        self.open()?
            .execute("DELETE FROM moves WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(super) fn list(&self) -> Result<Vec<RecoveryEntry>, String> {
        let db = self.open()?;
        let mut statement = db.prepare("SELECT id, profile, host, original, stage, destination, state FROM moves ORDER BY rowid DESC")
            .map_err(|e| e.to_string())?;
        let entries = statement
            .query_map([], |row| {
                Ok(RecoveryEntry {
                    id: row.get(0)?,
                    profile: row.get(1)?,
                    host: row.get(2)?,
                    original: row.get(3)?,
                    stage: row.get(4)?,
                    destination: row.get(5)?,
                    state: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        entries
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn get(&self, id: &str) -> Result<Option<RecoveryEntry>, String> {
        let db = self.open()?;
        db.query_row(
            "SELECT id, profile, host, original, stage, destination, state FROM moves WHERE id=?1",
            [id],
            |row| {
                Ok(RecoveryEntry {
                    id: row.get(0)?,
                    profile: row.get(1)?,
                    host: row.get(2)?,
                    original: row.get(3)?,
                    stage: row.get(4)?,
                    destination: row.get(5)?,
                    state: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }
}

pub(crate) fn stage_path(original: &str, id: &str) -> Result<(String, String), String> {
    check_path(original, false).map_err(|e| e.message().to_owned())?;
    let (parent, name) = original.rsplit_once('/').ok_or("Invalid remote source.")?;
    if name.is_empty()
        || name == "."
        || name == ".."
        || id.len() != 32
        || !id.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid remote source or recovery ID.".into());
    }
    let dir = format!("{parent}/.stratum-move-{id}");
    let staged = format!("{dir}/{name}");
    check_path(&staged, false).map_err(|e| e.message().to_owned())?;
    Ok((dir, staged))
}

#[tauri::command]
pub(crate) async fn remote_move_recovery_list(
    webview: Webview,
) -> Result<Vec<RecoveryEntry>, String> {
    manager(&webview)?;
    RecoveryJournal::for_webview(&webview)?.list()
}

#[tauri::command]
pub(crate) async fn remote_move_destination_stages(
    webview: Webview,
) -> Result<Vec<DestinationStage>, String> {
    manager(&webview)?;
    RecoveryJournal::for_webview(&webview)?.destination_stages()
}

// Explicit cleanup is allowed only for a completed copy. A partial failure
// leaves the record pointing at the remaining original.
pub(crate) async fn delete_original(
    remotes: &Remotes,
    journal: &RecoveryJournal,
    id: &str,
    profile: &str,
    session_id: u32,
) -> Result<(), String> {
    let _active = ActiveMove::start(id)?;
    let entry = journal.get(id)?.ok_or("Recovery entry not found.")?;
    if entry.state != "published" {
        return Err("The move was not confirmed complete. Restore the original instead.".into());
    }
    let session = remotes.current(profile, Some(session_id))?;
    if session.host != entry.host {
        return Err("This host no longer matches the recovery record.".into());
    }
    let (dir, staged) = stage_path(&entry.original, &entry.id)?;
    if staged != entry.stage {
        return Err("Invalid recovery record.".into());
    }
    if remotes.exists(profile, session_id, &staged).await? {
        super::operations::purge_staged(remotes, profile, session_id, &staged).await?;
    }
    if remotes.exists(profile, session_id, &dir).await? {
        super::transfer::tree::remote_remove(&session, &dir, true)
            .await
            .map_err(|e| {
                format!("The original was removed, but the recovery folder remains at {dir}: {e}")
            })?;
    }
    journal.remove(id)
}

#[tauri::command]
pub(crate) async fn remote_move_recovery_delete(
    webview: Webview,
    id: String,
    profile_id: String,
    session_id: u32,
) -> Result<(), String> {
    delete_original(
        &manager(&webview)?,
        &RecoveryJournal::for_webview(&webview)?,
        &id,
        &profile_id,
        session_id,
    )
    .await
}

pub(crate) async fn cleanup_destination(
    remotes: &Remotes,
    journal: &RecoveryJournal,
    id: &str,
    profile: Option<&str>,
    session_id: Option<u32>,
) -> Result<(), String> {
    let _active = ActiveMove::start(id)?;
    let entry = journal.destination_stage(id)?;
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid staging record.".into());
    }
    let name = format!(".stratum-move-copy-{id}");
    if entry.kind == "local" {
        use crate::domain::filesystem::staging::StageDirectory;
        let folder = PathBuf::from(&entry.folder);
        let path = PathBuf::from(&entry.path);
        if !folder.is_absolute() || folder.join(&name) != path {
            return Err("Invalid staging path.".into());
        }
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return journal.clear_destination(id)
            }
            Err(e) => return Err(format!("Could not inspect staging: {e}")),
            Ok(_) => {}
        }
        let guard = StageDirectory::open_existing(path.clone())
            .map_err(|e| format!("Could not open staging safely: {e}"))?;
        let identity = entry
            .identity
            .as_ref()
            .ok_or("Staging identity was not saved; inspect the folder manually.")?;
        if &guard.identity().map_err(|e| e.to_string())? != identity {
            return Err("The staging folder was replaced; it was kept.".into());
        }
        guard
            .remove_contents()
            .map_err(|e| format!("Could not clean staging at {}: {e}", path.display()))?;
        drop(guard);
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => journal.clear_destination(id),
            Err(e) => Err(format!("Could not check staging: {e}")),
            Ok(_) => Err(format!(
                "The empty staging folder remains at {}.",
                path.display()
            )),
        }
    } else if entry.kind == "remote" {
        let profile = profile.ok_or("Connect the destination host first.")?;
        let session_id = session_id.ok_or("Connect the destination host first.")?;
        let session = remotes.current(profile, Some(session_id))?;
        if session.host != entry.host {
            return Err("This host no longer matches the staging record.".into());
        }
        let expected = format!("{}/{name}", entry.folder.trim_end_matches('/'));
        if expected != entry.path {
            return Err("Invalid staging path.".into());
        }
        {
            let mut wire = session.wire.lock().await;
            session
                .complete(
                    async {
                        if super::browse::canonical(&mut wire, &entry.folder).await? != entry.folder
                        {
                            return Err(super::wire::Error::Request(
                                "The destination folder changed; staging was kept.".into(),
                            ));
                        }
                        Ok(())
                    },
                    60,
                )
                .await?;
        }
        if remotes.exists(profile, session_id, &entry.path).await? {
            if entry.identity.as_deref() != Some("created") {
                return Err(
                    "Staging creation was not confirmed; inspect the folder manually.".into(),
                );
            }
            super::operations::purge_staged(remotes, profile, session_id, &entry.path).await?;
        }
        journal.clear_destination(id)
    } else {
        Err("Unknown staging record.".into())
    }
}

#[tauri::command]
pub(crate) async fn remote_move_destination_cleanup(
    webview: Webview,
    id: String,
    profile_id: Option<String>,
    session_id: Option<u32>,
) -> Result<(), String> {
    cleanup_destination(
        &manager(&webview)?,
        &RecoveryJournal::for_webview(&webview)?,
        &id,
        profile_id.as_deref(),
        session_id,
    )
    .await
}

// The original name is never overwritten. Keep the journal on ambiguous errors.
pub(crate) async fn restore(
    remotes: &Remotes,
    journal: &RecoveryJournal,
    id: &str,
    profile_id: &str,
    session_id: u32,
) -> Result<(), String> {
    let _active = ActiveMove::start(id)?;
    restore_active(remotes, journal, id, profile_id, session_id).await
}

// The transfer already owns the activity guard while undoing its own staging.
pub(super) async fn restore_active(
    remotes: &Remotes,
    journal: &RecoveryJournal,
    id: &str,
    profile_id: &str,
    session_id: u32,
) -> Result<(), String> {
    let entry = journal.get(id)?.ok_or("Recovery entry not found.")?;
    if entry.state == "restored_partial" {
        return Err("The remaining original was already restored. Review its location in Work.".into());
    }
    if entry.state == "planned" {
        return Err(
            "Staging creation was not confirmed; inspect the recovery folder manually.".into(),
        );
    }
    let session = remotes.current(profile_id, Some(session_id))?;
    if session.host != entry.host {
        return Err("This host no longer matches the recovery record.".into());
    }
    let (dir, staged) = stage_path(&entry.original, &entry.id)?;
    if staged != entry.stage {
        return Err("Invalid recovery record.".into());
    }
    let parent = entry
        .original
        .rsplit_once('/')
        .map(|(p, _)| if p.is_empty() { "/" } else { p })
        .ok_or("Invalid recovery path.")?;
    {
        use super::wire::{put_string, Error, Reply, Request};
        let mut wire = session.wire.lock().await;
        session
            .complete(
                async {
                    if super::browse::canonical(&mut wire, parent).await? != parent
                        || super::browse::canonical(&mut wire, &dir).await? != dir
                    {
                        return Err(Error::Request(
                            "The recovery folder changed. The original was kept.".into(),
                        ));
                    }
                    match wire
                        .path_request(Request::Lstat, entry.original.as_bytes(), Reply::Attrs)
                        .await
                    {
                        Err(Error::NotFound) => {}
                        Ok(_) => {
                            return Err(Error::Request(
                                "The original location is occupied. The recovery copy was kept."
                                    .into(),
                            ))
                        }
                        Err(error) => return Err(error),
                    }
                    let mut payload = Vec::new();
                    put_string(&mut payload, staged.as_bytes());
                    put_string(&mut payload, entry.original.as_bytes());
                    wire.request(Request::Rename, &payload, Reply::Status)
                        .await?;
                    Ok(())
                },
                60,
            )
            .await?;
    }
    // A failed directory cleanup never deletes the restored original.
    let _ = super::transfer::tree::remote_remove(&session, &dir, true).await;
    finish_restored_move(journal, &entry)
}

// After publication, cleanup may already have removed some source children.
fn finish_restored_move(journal: &RecoveryJournal, entry: &RecoveryEntry) -> Result<(), String> {
    if entry.state == "published" {
        return journal.state(&entry.id, "restored_partial");
    }
    journal.remove(&entry.id)
}

// Restore interrupted moves without overwriting anything at the original path.
pub(super) async fn recover_active(
    remotes: &Remotes,
    journal: &RecoveryJournal,
    id: &str,
    profile: &str,
    session_id: u32,
) -> Result<(), String> {
    let entry = journal.get(id)?.ok_or("Transfer record not found.")?;
    let session = remotes.current(profile, Some(session_id))?;
    if session.host != entry.host {
        return Err("The host does not match the transfer.".into());
    }
    let (directory, staged) = stage_path(&entry.original, &entry.id)?;
    if staged != entry.stage {
        return Err("Invalid transfer record.".into());
    }
    if remotes.exists(profile, session_id, &staged).await? {
        return restore_active(remotes, journal, id, profile, session_id).await;
    }
    if remotes.exists(profile, session_id, &entry.original).await? {
        // Only remove an empty, privately named folder; never delete its contents.
        if entry.state != "planned" {
            let _ = super::transfer::tree::remote_remove(&session, &directory, true).await;
        }
        return finish_restored_move(journal, &entry);
    }
    if entry.state == "published" {
        let _ = super::transfer::tree::remote_remove(&session, &directory, true).await;
        return journal.remove(id);
    }
    Err(format!(
        "The original could not be located. Check {} on {}.",
        entry.stage, entry.host
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveredTransfers {
    restored: Vec<String>,
    warnings: Vec<String>,
    delete_notice_ids: Vec<String>,
}

// On reconnect, restore interrupted originals and report remaining copies.
#[tauri::command]
pub(crate) async fn remote_finish_interrupted_transfers(
    webview: Webview,
    profile_id: String,
    session_id: u32,
) -> Result<RecoveredTransfers, String> {
    let remotes = manager(&webview)?;
    let journal = RecoveryJournal::for_webview(&webview)?;
    check_interrupted(&remotes, &journal, &profile_id, session_id).await
}

pub(super) async fn check_interrupted(
    remotes: &Remotes,
    journal: &RecoveryJournal,
    profile_id: &str,
    session_id: u32,
) -> Result<RecoveredTransfers, String> {
    let session = remotes.current(profile_id, Some(session_id))?;
    let mut restored = Vec::new();
    let mut warnings = Vec::new();
    let mut delete_notice_ids = Vec::new();
    super::delete_recovery::recover_interrupted_deletes(
        remotes,
        journal,
        &session.host,
        profile_id,
        session_id,
        &mut restored,
        &mut warnings,
        &mut delete_notice_ids,
    )
    .await?;
    for entry in journal
        .list()?
        .into_iter()
        .filter(|entry| entry.host == session.host)
    {
        let Ok(_active) = ActiveMove::start(&entry.id) else {
            continue;
        };
        if entry.state == "restored_partial" {
            warnings.push(format!("Check {} on {}. Some original contents may have been removed after the move was copied.", entry.original, entry.host));
            continue;
        }
        match recover_active(remotes, journal, &entry.id, profile_id, session_id).await {
            Ok(()) => {
                if entry.state == "published" && journal.get(&entry.id)?.is_some() {
                    warnings.push(format!(
                        "Check {} on {}. Some original contents may have been removed.",
                        entry.original, entry.host
                    ));
                }
                restored.push(entry.original);
            }
            Err(error) => {
                if !journal.reviewed_source("move", &entry.id, &entry.state)? {
                    warnings.push(format!("Could not restore {}: {error} Check {} on {}.", entry.original, entry.stage, entry.host));
                }
            }
        }
    }
    for stage in journal.destination_stages()? {
        let Ok(_active) = ActiveMove::start(&stage.id) else {
            continue;
        };
        let exists = if stage.kind == "local" {
            !matches!(fs::symlink_metadata(&stage.path), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
        } else if stage.host == session.host {
            remotes
                .exists(profile_id, session_id, &stage.path)
                .await
                .unwrap_or(true)
        } else {
            continue;
        };
        if exists {
            let host = if stage.kind == "local" {
                "this PC"
            } else {
                &stage.host
            };
            warnings.push(format!(
                "Check {} on {host} for remaining transfer data.",
                stage.path
            ));
        } else {
            journal.clear_destination(&stage.id)?;
        }
    }
    Ok(RecoveredTransfers {
        restored,
        warnings,
        delete_notice_ids,
    })
}

#[tauri::command]
pub(crate) async fn remote_move_recovery_forget(
    webview: Webview,
    id: String,
) -> Result<(), String> {
    manager(&webview)?;
    let _active = ActiveMove::start(&id)?;
    RecoveryJournal::for_webview(&webview)?.remove(&id)
}

#[tauri::command]
pub(crate) async fn remote_move_recovery_restore(
    webview: Webview,
    id: String,
    profile_id: String,
    session_id: u32,
) -> Result<(), String> {
    restore(
        &manager(&webview)?,
        &RecoveryJournal::for_webview(&webview)?,
        &id,
        &profile_id,
        session_id,
    )
    .await
}

#[cfg(test)]
pub(super) fn test_journal(path: &std::path::Path) -> RecoveryJournal {
    RecoveryJournal(path.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::filesystem::staging::StageDirectory;

    #[test]
    fn local_cleanup_checks_identity_and_does_not_follow_junctions() {
        tauri::async_runtime::block_on(async {
            let mut random = [0u8; 16];
            getrandom::fill(&mut random).unwrap();
            let root = std::env::temp_dir().join(format!(
                "stratum-stage-test-{:032x}",
                u128::from_le_bytes(random)
            ));
            fs::create_dir(&root).unwrap();
            let journal = test_journal(&root.join("journal.sqlite"));
            let id = "1234567890abcdef1234567890abcdef";
            let path = root.join(format!(".stratum-move-copy-{id}"));
            let stage = StageDirectory::create(path.clone()).unwrap();
            let identity = stage.identity().unwrap();
            fs::write(path.join("partial"), b"partial").unwrap();
            let outside = root.join("outside");
            fs::create_dir(&outside).unwrap();
            fs::write(outside.join("keep"), b"keep").unwrap();
            let junction = path.join("link");
            let output = std::process::Command::new("cmd.exe")
                .args(["/d", "/c", "mklink", "/J"])
                .arg(&junction)
                .arg(&outside)
                .output()
                .unwrap();
            assert!(output.status.success(), "{output:?}");
            drop(stage);
            journal
                .track_destination(&DestinationStage {
                    id: id.into(),
                    kind: "local".into(),
                    host: String::new(),
                    folder: root.to_string_lossy().into_owned(),
                    path: path.to_string_lossy().into_owned(),
                    identity: Some(identity),
                }, "source", "/original")
                .unwrap();
            let old = root.join("old-stage");
            fs::rename(&path, &old).unwrap();
            fs::create_dir(&path).unwrap();
            fs::write(path.join("unrelated"), b"safe").unwrap();
            assert!(
                cleanup_destination(&Remotes::default(), &journal, id, None, None)
                    .await
                    .is_err()
            );
            assert_eq!(fs::read(path.join("unrelated")).unwrap(), b"safe");
            fs::remove_dir_all(&path).unwrap();
            fs::rename(&old, &path).unwrap();
            // Reopening the database models recovery after the app restarts.
            let reopened = test_journal(&root.join("journal.sqlite"));
            cleanup_destination(&Remotes::default(), &reopened, id, None, None)
                .await
                .unwrap();
            assert!(!path.exists());
            assert_eq!(fs::read(outside.join("keep")).unwrap(), b"keep");
            assert!(reopened.destination_stages().unwrap().is_empty());
            let unknown_id = "abcdefabcdefabcdefabcdefabcdefab";
            let unknown_path = root.join(format!(".stratum-move-copy-{unknown_id}"));
            fs::create_dir(&unknown_path).unwrap();
            fs::write(unknown_path.join("keep"), b"keep").unwrap();
            reopened
                .track_destination(&DestinationStage {
                    id: unknown_id.into(),
                    kind: "local".into(),
                    host: String::new(),
                    folder: root.to_string_lossy().into_owned(),
                    path: unknown_path.to_string_lossy().into_owned(),
                    identity: None,
                }, "source", "/original")
                .unwrap();
            assert!(
                cleanup_destination(&Remotes::default(), &reopened, unknown_id, None, None)
                    .await
                    .is_err()
            );
            assert_eq!(fs::read(unknown_path.join("keep")).unwrap(), b"keep");
            fs::remove_dir_all(root).unwrap();
        });
    }

    #[test]
    #[ignore = "set STRATUM_SFTP_TEST_HOST and STRATUM_SFTP_LINK_FIXTURE"]
    fn remote_cleanup_never_follows_links() {
        tauri::async_runtime::block_on(async {
            use std::sync::Arc;
            let host = std::env::var("STRATUM_SFTP_TEST_HOST").unwrap();
            let folder = std::env::var("STRATUM_SFTP_LINK_FIXTURE").unwrap();
            let remotes = Remotes::default();
            let conn = remotes
                .connect("links", &host, "", Arc::new(|_| {}))
                .await
                .unwrap();
            let root =
                std::env::temp_dir().join(format!("stratum-link-cleanup-{}", std::process::id()));
            fs::create_dir(&root).unwrap();
            let journal = test_journal(&root.join("journal.sqlite"));
            let ids = [
                "11111111111111111111111111111111",
                "22222222222222222222222222222222",
                "33333333333333333333333333333333",
            ];
            for id in ids {
                journal
                    .track_destination(&DestinationStage {
                        id: id.into(),
                        kind: "remote".into(),
                        host: host.clone(),
                        folder: folder.clone(),
                        path: format!("{folder}/.stratum-move-copy-{id}"),
                        identity: (id != ids[2]).then(|| "created".into()),
                    }, "source", "/original")
                    .unwrap();
            }
            cleanup_destination(
                &remotes,
                &journal,
                ids[0],
                Some("links"),
                Some(conn.session_id),
            )
            .await
            .unwrap();
            assert!(!remotes
                .exists(
                    "links",
                    conn.session_id,
                    &format!("{folder}/.stratum-move-copy-{}", ids[0])
                )
                .await
                .unwrap());
            assert_eq!(
                remotes
                    .read_range(
                        "links",
                        conn.session_id,
                        &format!("{folder}/outside/keep"),
                        0,
                        4
                    )
                    .await
                    .unwrap()
                    .bytes,
                b"keep"
            );
            assert!(cleanup_destination(
                &remotes,
                &journal,
                ids[2],
                Some("links"),
                Some(conn.session_id)
            )
            .await
            .is_err());
            assert_eq!(
                remotes
                    .read_range(
                        "links",
                        conn.session_id,
                        &format!("{folder}/.stratum-move-copy-{}/keep", ids[2]),
                        0,
                        4
                    )
                    .await
                    .unwrap()
                    .bytes,
                b"keep"
            );
            assert!(cleanup_destination(
                &remotes,
                &journal,
                ids[1],
                Some("links"),
                Some(conn.session_id)
            )
            .await
            .is_err());
            assert!(remotes
                .exists(
                    "links",
                    conn.session_id,
                    &format!("{folder}/.stratum-move-copy-{}", ids[1])
                )
                .await
                .unwrap());
            assert_eq!(
                remotes
                    .read_range(
                        "links",
                        conn.session_id,
                        &format!("{folder}/outside/keep"),
                        0,
                        4
                    )
                    .await
                    .unwrap()
                    .bytes,
                b"keep"
            );
            remotes.disconnect("links").await;
            fs::remove_dir_all(root).unwrap();
        });
    }
}
