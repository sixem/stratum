// The worker owns HTTP and retry scheduling. Only a successful HTTP status acknowledges a delivery.
use super::{
    store::{now, storage, Store},
    target::Target,
};
use reqwest::{redirect, Client, StatusCode};
use rusqlite::{params, OptionalExtension};
use std::time::Duration;

pub(super) const MAX_ATTEMPTS: u32 = 3;

pub(super) struct Attempt {
    pub id: i64,
    pub hook: String,
    pub kind: String,
    pub body: String,
    attempt: u32,
    target: Result<Target, String>,
}

pub(super) enum Next {
    Send(Attempt),
    Wait(Option<Duration>),
}

impl Store {
    pub fn next(&self) -> Result<Next, String> {
        let row = self.conn.query_row("SELECT d.id,d.hook,d.kind,d.body,d.attempts,d.due,
                d.fingerprint=h.fingerprint,h.target FROM deliveries d JOIN hooks h ON h.id=d.hook
                WHERE d.state='pending' AND (h.enabled OR d.kind='webhook.test') ORDER BY d.due,d.id LIMIT 1",
            [], |r| Ok((r.get::<_,i64>(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get::<_,u32>(4)?,r.get::<_,i64>(5)?,
                r.get::<_,bool>(6)?,r.get::<_,Vec<u8>>(7)?))).optional().map_err(storage)?;
        let Some((id, hook, kind, body, attempts, due, same_destination, protected)) = row else {
            return Ok(Next::Wait(None));
        };
        let delay = due.saturating_sub(now());
        if delay > 0 {
            return Ok(Next::Wait(Some(Duration::from_millis(delay as u64))));
        }
        let target = if same_destination {
            Target::open(&protected)
        } else {
            Err("Destination changed. Restore the original URL to retry this event.".into())
        };
        self.conn
            .execute(
                "UPDATE deliveries SET state='sending', attempts=attempts+1 WHERE id=?1",
                [id],
            )
            .map_err(storage)?;
        Ok(Next::Send(Attempt {
            id,
            hook,
            kind,
            body,
            attempt: attempts + 1,
            target,
        }))
    }

    // true means the delivery reached a final result for this retry cycle.
    pub fn settle(&self, job: &Attempt, result: &Result<(), Failure>) -> Result<bool, String> {
        let failure = match result {
            Ok(()) => {
                self.conn
                    .execute("DELETE FROM deliveries WHERE id=?1", [job.id])
                    .map_err(storage)?;
                return Ok(true);
            }
            Err(failure) => failure,
        };
        let retry = failure.transient && job.attempt < MAX_ATTEMPTS;
        let due = now() + if job.attempt == 1 { 1000 } else { 4000 };
        self.conn
            .execute(
                "UPDATE deliveries SET state=?1,due=?2,error=?3 WHERE id=?4",
                params![
                    if retry { "pending" } else { "failed" },
                    due,
                    failure.message,
                    job.id
                ],
            )
            .map_err(storage)?;
        Ok(!retry)
    }
}

#[derive(Clone)]
pub(super) struct Failure {
    pub message: String,
    pub(super) transient: bool,
}

pub(super) struct Clients {
    https: Client,
    loopback: Client,
}

pub(super) fn client(timeout: Duration) -> Result<Clients, String> {
    let builder = || {
        Client::builder()
            .redirect(redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(4))
            .timeout(timeout)
    };
    let error = |_| "Could not initialize webhook HTTP delivery.".to_string();
    Ok(Clients {
        https: builder().https_only(true).build().map_err(error)?,
        loopback: builder().no_proxy().build().map_err(error)?,
    })
}

pub(super) async fn send(clients: &Clients, attempt: &Attempt) -> Result<(), Failure> {
    let target = attempt.target.as_ref().map_err(|message| Failure {
        message: message.clone(),
        transient: false,
    })?;
    // Never send an unencrypted loopback URL or token through a system proxy.
    let client = if target.url.starts_with("http://") {
        &clients.loopback
    } else {
        &clients.https
    };
    let mut request = client
        .post(&target.url)
        .header("Content-Type", "application/json")
        .body(attempt.body.clone());
    if !target.token.is_empty() {
        request = request.bearer_auth(&target.token);
    }
    // reqwest errors and response bodies may contain credentials. Publish only safe categories.
    let response = request.send().await.map_err(|err| Failure {
        message: if err.is_timeout() {
            "Request timed out."
        } else {
            "Could not reach the receiver over HTTP."
        }
        .into(),
        transient: true,
    })?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    Err(Failure {
        message: format!("Receiver returned HTTP {}.", status.as_u16()),
        transient: status.is_server_error()
            || matches!(
                status,
                StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_EARLY | StatusCode::TOO_MANY_REQUESTS
            ),
    })
}
