// One profile-local SQLite database owns subscriptions and undelivered requests.
// A delivery retains the destination fingerprint so edits cannot reroute an old payload.
use super::{
    payload::{self, EVENT_TYPES},
    target::Target,
};
use crate::services::operation_events::OperationEvent;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::Arc,
    time::{Instant, SystemTime},
};
use uuid::Uuid;

pub(super) fn storage(_: rusqlite::Error) -> String {
    "Could not read or write the webhook database.".into()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Hook {
    pub id: String,
    pub name: String,
    pub origin: String,
    pub enabled: bool,
    pub events: Vec<String>,
    pub has_token: bool,
    #[serde(skip)]
    active_since: Instant,
    #[serde(skip)]
    fingerprint: Vec<u8>,
    #[serde(skip)]
    history: Vec<Subscription>,
}

#[derive(Clone)]
struct Subscription {
    from: Instant,
    until: Instant,
    events: Vec<String>,
    fingerprint: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Edit {
    pub id: Option<String>,
    pub name: String,
    pub enabled: bool,
    pub events: Vec<String>,
    // An omitted field preserves its saved value. A new URL requires a new token.
    pub url: Option<String>,
    pub token: Option<String>,
}

pub(super) struct Store {
    pub conn: Connection,
    pub hooks: Vec<Hook>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(storage)?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS hooks(
                id TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL, enabled INTEGER NOT NULL,
                events TEXT NOT NULL, has_token INTEGER NOT NULL, target BLOB NOT NULL, fingerprint BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS deliveries(
                id INTEGER PRIMARY KEY AUTOINCREMENT, hook TEXT NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
                event_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, fingerprint BLOB NOT NULL,
                state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
                due INTEGER NOT NULL DEFAULT 0, error TEXT, UNIQUE(hook,event_id));
            CREATE INDEX IF NOT EXISTS delivery_schedule ON deliveries(state,due,id);
            CREATE TABLE IF NOT EXISTS capture_notice(id INTEGER PRIMARY KEY CHECK(id=1), missed INTEGER NOT NULL);
            INSERT OR IGNORE INTO capture_notice VALUES(1,0);").map_err(storage)?;
        // A sent request can reach the receiver just before Stratum closes.
        conn.execute(
            "UPDATE deliveries SET state=CASE WHEN attempts>=?1 THEN 'failed' ELSE 'pending' END,
            error='Stratum closed before confirming delivery.' WHERE state='sending'",
            [super::delivery::MAX_ATTEMPTS],
        )
        .map_err(storage)?;
        let hooks = {
            let mut query = conn
                .prepare("SELECT id,name,origin,enabled,events,has_token,fingerprint FROM hooks ORDER BY rowid")
                .map_err(storage)?;
            let rows = query
                .query_map([], |r| {
                    Ok((
                        Hook {
                            id: r.get(0)?,
                            name: r.get(1)?,
                            origin: r.get(2)?,
                            enabled: r.get(3)?,
                            events: vec![],
                            has_token: r.get(5)?,
                            active_since: Instant::now(),
                            fingerprint: r.get(6)?,
                            history: Vec::new(),
                        },
                        r.get::<_, String>(4)?,
                    ))
                })
                .map_err(storage)?;
            let mut hooks = Vec::new();
            for row in rows {
                let (mut hook, events) = row.map_err(storage)?;
                hook.events = serde_json::from_str(&events)
                    .map_err(|_| "Could not read webhook event filters.")?;
                hooks.push(hook);
            }
            hooks
        };
        Ok(Self { conn, hooks })
    }

    pub fn save(&mut self, mut edit: Edit) -> Result<(), String> {
        edit.name = edit.name.trim().to_owned();
        if edit.name.is_empty() || edit.name.chars().count() > 80 {
            return Err("Enter a webhook name of up to 80 characters.".into());
        }
        edit.events.sort();
        edit.events.dedup();
        if edit.events.is_empty()
            || edit
                .events
                .iter()
                .any(|e| !EVENT_TYPES.contains(&e.as_str()))
        {
            return Err("Select at least one supported event type.".into());
        }
        let mut target = if let Some(id) = &edit.id {
            let bytes: Vec<u8> = self
                .conn
                .query_row("SELECT target FROM hooks WHERE id=?1", [id], |r| r.get(0))
                .optional()
                .map_err(storage)?
                .ok_or("This webhook no longer exists.")?;
            Target::open(&bytes)?
        } else {
            Target {
                url: String::new(),
                token: String::new(),
                fingerprint_salt: *Uuid::new_v4().as_bytes(),
            }
        };
        let mut changed_url = false;
        if let Some(url) = edit.url {
            let replacement = reqwest::Url::parse(url.trim())
                .map_err(|_| "Enter a valid webhook URL.")?
                .to_string();
            if target.url != replacement {
                changed_url = true;
                target.token.clear();
            }
            target.url = replacement;
        }
        if let Some(token) = edit.token {
            target.token = token;
        }
        let origin = target.validate()?.origin().ascii_serialization();
        let fingerprint = Sha256::new()
            .chain_update(target.fingerprint_salt)
            .chain_update(target.url.as_bytes())
            .finalize()
            .to_vec();
        let mut hook = Hook {
            id: edit.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            name: edit.name,
            origin,
            enabled: edit.enabled,
            events: edit.events,
            has_token: !target.token.is_empty(),
            active_since: Instant::now(),
            fingerprint: fingerprint.clone(),
            history: Vec::new(),
        };
        let filter =
            serde_json::to_string(&hook.events).map_err(|_| "Could not encode webhook filters.")?;
        self.conn
            .execute(
                "INSERT INTO hooks(id,name,origin,enabled,events,has_token,target,fingerprint)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
            origin=excluded.origin,enabled=excluded.enabled,events=excluded.events,
            has_token=excluded.has_token,target=excluded.target,fingerprint=excluded.fingerprint",
                params![
                    hook.id,
                    hook.name,
                    hook.origin,
                    hook.enabled,
                    filter,
                    hook.has_token,
                    target.seal()?,
                    fingerprint
                ],
            )
            .map_err(storage)?;
        hook.active_since = Instant::now();
        if let Some(saved) = self.hooks.iter_mut().find(|h| h.id == hook.id) {
            hook.history = std::mem::take(&mut saved.history);
            if !changed_url && saved.enabled == hook.enabled && saved.events == hook.events {
                hook.active_since = saved.active_since;
            } else if saved.enabled {
                hook.history.push(Subscription {
                    from: saved.active_since,
                    until: hook.active_since,
                    events: saved.events.clone(),
                    fingerprint: saved.fingerprint.clone(),
                });
            }
            *saved = hook;
        } else {
            self.hooks.push(hook);
        }
        Ok(())
    }

    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM hooks WHERE id=?1", [id])
            .map_err(storage)?;
        self.hooks.retain(|h| h.id != id);
        Ok(())
    }

    pub fn capture(&mut self, events: &[Arc<OperationEvent>], lag: u64) -> Result<bool, String> {
        let tx = self.conn.transaction().map_err(storage)?;
        let mut queued = false;
        for event in events {
            let mut matching = self
                .hooks
                .iter()
                .filter_map(|hook| {
                    let current = hook.enabled
                        && event.emitted_at >= hook.active_since
                        && hook.events.iter().any(|e| e == event.name());
                    let fingerprint = if current {
                        Some(&hook.fingerprint)
                    } else {
                        hook.history
                            .iter()
                            .find(|old| {
                                event.emitted_at >= old.from
                                    && event.emitted_at < old.until
                                    && old.events.iter().any(|e| e == event.name())
                            })
                            .map(|old| &old.fingerprint)
                    };
                    fingerprint.map(|fingerprint| (&hook.id, fingerprint))
                })
                .peekable();
            if matching.peek().is_none() {
                continue;
            }
            let body = payload::operation(event).to_string();
            let id = event.id.to_string();
            for (hook, fingerprint) in matching {
                tx.execute("INSERT INTO deliveries(hook,event_id,kind,body,fingerprint,due) VALUES(?1,?2,?3,?4,?5,?6)",
                    params![hook,id,event.name(),body,fingerprint,now()]).map_err(storage)?;
                queued = true;
            }
        }
        if lag > 0 {
            tx.execute(
                "UPDATE capture_notice SET missed=missed+?1 WHERE id=1",
                [lag],
            )
            .map_err(storage)?;
        }
        tx.commit().map_err(storage)?;
        Ok(queued)
    }

    pub fn test_event(&self, hook: &str) -> Result<(), String> {
        if !self.hooks.iter().any(|h| h.id == hook) {
            return Err("This webhook no longer exists.".into());
        }
        let id = Uuid::new_v4();
        enqueue(
            &self.conn,
            hook,
            &id.to_string(),
            "webhook.test",
            &payload::test_event(&id).to_string(),
        )
    }
}

fn enqueue(
    conn: &Connection,
    hook: &str,
    event: &str,
    kind: &str,
    body: &str,
) -> Result<(), String> {
    conn.execute("INSERT INTO deliveries(hook,event_id,kind,body,fingerprint,due) SELECT id,?2,?3,?4,fingerprint,?5 FROM hooks WHERE id=?1",
        params![hook,event,kind,body,now()]).map_err(storage)?;
    Ok(())
}

pub(super) fn now() -> i64 {
    payload::millis(SystemTime::now())
}
