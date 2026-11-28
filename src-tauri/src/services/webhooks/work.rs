// Work contains unresolved delivery failures. Successful requests are removed immediately.
use super::store::{now, storage, Store};
use rusqlite::params;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FailureRow {
    id: i64,
    name: String,
    origin: String,
    kind: String,
    event_id: String,
    error: String,
    attempts: u32,
    pub can_retry: bool,
}

#[derive(Serialize)]
pub(crate) struct Work {
    pub failures: Vec<FailureRow>,
    pub total: usize,
    pub missed: u64,
    pub error: Option<String>,
}

impl Store {
    pub fn work(&self) -> Result<Work, String> {
        let mut query = self.conn.prepare("SELECT d.id,h.name,h.origin,d.kind,d.event_id,d.error,d.attempts,
            (h.enabled OR d.kind='webhook.test') AND h.fingerprint=d.fingerprint
            FROM deliveries d JOIN hooks h ON h.id=d.hook WHERE d.state='failed' ORDER BY d.id LIMIT 100").map_err(storage)?;
        let failures = query
            .query_map([], |r| {
                Ok(FailureRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    origin: r.get(2)?,
                    kind: r.get(3)?,
                    event_id: r.get(4)?,
                    error: r.get(5)?,
                    attempts: r.get(6)?,
                    can_retry: r.get(7)?,
                })
            })
            .map_err(storage)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage)?;
        let total = self
            .conn
            .query_row(
                "SELECT count(*) FROM deliveries WHERE state='failed'",
                [],
                |r| r.get(0),
            )
            .map_err(storage)?;
        let missed = self
            .conn
            .query_row("SELECT missed FROM capture_notice WHERE id=1", [], |r| {
                r.get(0)
            })
            .map_err(storage)?;
        Ok(Work {
            failures,
            total,
            missed,
            error: None,
        })
    }

    pub fn retry(&self, id: i64) -> Result<(), String> {
        let changed = self.conn.execute("UPDATE deliveries SET state='pending', attempts=0,due=?2,error=NULL
            WHERE id=?1 AND state='failed' AND EXISTS(SELECT 1 FROM hooks h WHERE h.id=deliveries.hook
            AND (h.enabled OR deliveries.kind='webhook.test') AND h.fingerprint=deliveries.fingerprint)",params![id,now()]).map_err(storage)?;
        if changed == 0 {
            return Err(
                "This delivery cannot be retried. Check its destination and enabled status.".into(),
            );
        }
        Ok(())
    }

    pub fn dismiss(&self, id: Option<i64>) -> Result<(), String> {
        if let Some(id) = id {
            self.conn
                .execute(
                    "DELETE FROM deliveries WHERE id=?1 AND state='failed'",
                    [id],
                )
                .map_err(storage)?;
        } else {
            self.conn
                .execute("UPDATE capture_notice SET missed=0 WHERE id=1", [])
                .map_err(storage)?;
        }
        Ok(())
    }
}
