// SQLite capture and HTTP delivery run independently of filesystem workers and of each other.
mod commands;
mod delivery;
mod payload;
mod store;
mod target;
#[cfg(test)]
pub(crate) mod tests;
mod work;

use crate::services::operation_events::{OperationEvent, OperationEvents};
pub(crate) use commands::*;
use delivery::{Failure, Next};
use std::{
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use store::Store;
use tauri::async_runtime::{spawn, JoinHandle};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast, Notify};

struct Core {
    db: Mutex<Store>,
    wake: Notify,
    capture_wake: Notify,
    changed: Box<dyn Fn() + Send + Sync>,
    test_finished: Box<dyn Fn(&str, bool) + Send + Sync>,
    errors: Mutex<[Option<String>; 2]>,
}

impl Core {
    // SQLite commits and Windows credential access can block. Keep them off
    // the async runtime threads that also serve SFTP and the application.
    async fn database<T: Send + 'static>(
        self: &Arc<Self>,
        action: impl FnOnce(&mut Store) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let core = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut db = core.store()?;
            action(&mut db)
        })
        .await
        .map_err(|_| "The webhook storage worker stopped.".to_owned())?
    }

    fn store(&self) -> Result<MutexGuard<'_, Store>, String> {
        self.db
            .lock()
            .map_err(|_| "Webhook storage is unavailable.".into())
    }
    fn problem(&self, index: usize, error: Option<String>) {
        let mut errors = self.errors.lock().unwrap_or_else(|e| e.into_inner());
        if errors[index] != error {
            errors[index] = error;
            drop(errors);
            (self.changed)();
        }
    }
}

struct Engine {
    core: Arc<Core>,
    events: OperationEvents,
    capture: Arc<Mutex<Option<JoinHandle<()>>>>,
    worker: JoinHandle<()>,
}

impl Engine {
    fn start(
        store: Store,
        events: OperationEvents,
        changed: impl Fn() + Send + Sync + 'static,
        test_finished: impl Fn(&str, bool) + Send + Sync + 'static,
    ) -> Self {
        let active = store.hooks.iter().any(|h| h.enabled);
        let core = Arc::new(Core {
            db: Mutex::new(store),
            wake: Notify::new(),
            capture_wake: Notify::new(),
            changed: Box::new(changed),
            test_finished: Box::new(test_finished),
            errors: Mutex::new([None, None]),
        });
        let capture = Arc::new(Mutex::new(None));
        if active {
            *capture.lock().unwrap() = Some(spawn(capture_events(
                core.clone(),
                events.subscribe(),
                capture.clone(),
            )));
        }
        let worker = spawn(deliver(core.clone()));
        Self {
            core,
            events,
            worker,
            capture,
        }
    }

    fn configure(&self, edit: impl FnOnce(&mut Store) -> Result<(), String>) -> Result<(), String> {
        let mut store = self.core.store()?;
        edit(&mut store)?;
        let mut task = self.capture.lock().unwrap_or_else(|e| e.into_inner());
        if store.hooks.iter().any(|h| h.enabled) {
            if task.is_none() {
                *task = Some(spawn(capture_events(
                    self.core.clone(),
                    self.events.subscribe(),
                    self.capture.clone(),
                )));
            }
        } else {
            // Let capture commit events produced before the subscription was paused.
            self.core.capture_wake.notify_one();
        }
        drop(store);
        self.core.wake.notify_one();
        (self.core.changed)();
        Ok(())
    }

    fn stop(&self) {
        if let Some(task) = self
            .capture
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            task.abort();
        }
        self.worker.abort();
    }
}
impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
    }
}

pub(crate) struct Webhooks(Result<Engine, String>);
impl Webhooks {
    pub(crate) fn init(app: &AppHandle, events: OperationEvents) -> Self {
        let open = || {
            let dir = app
                .path()
                .app_local_data_dir()
                .map_err(|_| "Could not locate the webhook profile.")?;
            std::fs::create_dir_all(&dir)
                .map_err(|_| "Could not open the webhook profile folder.")?;
            let app = app.clone();
            let tests = app.clone();
            Ok(Engine::start(
                Store::open(&dir.join("webhooks.sqlite"))?,
                events,
                move || {
                    let _ = app.emit_to("main", "webhook-work-changed", ());
                },
                move |hook, ok| {
                    let _ = tests.emit_to(
                        "main",
                        "webhook-test-finished",
                        serde_json::json!({"hook":hook,"ok":ok}),
                    );
                },
            ))
        };
        Self(open())
    }
    pub(crate) fn shutdown(&self) {
        if let Ok(engine) = &self.0 {
            engine.stop();
        }
    }
}

async fn capture_events(
    core: Arc<Core>,
    mut receiver: broadcast::Receiver<Arc<OperationEvent>>,
    task: Arc<Mutex<Option<JoinHandle<()>>>>,
) {
    use broadcast::error::{RecvError, TryRecvError};
    loop {
        let mut events = Vec::new();
        let mut missed = 0;
        tokio::select! {
            result = receiver.recv() => match result {
                Ok(event) => events.push(event),
                Err(RecvError::Lagged(n)) => missed = n,
                Err(RecvError::Closed) => return,
            },
            _ = core.capture_wake.notified() => {},
        }
        while events.len() < 128 {
            match receiver.try_recv() {
                Ok(event) => events.push(event),
                Err(TryRecvError::Lagged(n)) => missed += n,
                Err(_) => break,
            }
        }
        if events.is_empty() && missed == 0 {
            // Serialize retirement with configuration so re-enabling always has a receiver.
            let task = task.clone();
            match core
                .database(move |db| {
                    if db.hooks.iter().any(|hook| hook.enabled) {
                        return Ok(false);
                    }
                    task.lock().unwrap_or_else(|e| e.into_inner()).take();
                    Ok(true)
                })
                .await
            {
                Ok(true) => return,
                Ok(false) => continue,
                Err(error) => {
                    core.problem(0, Some(error));
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
            }
        }
        // Keep the current batch until its transaction commits. The broadcast ring can
        // overrun during a storage outage, which is recorded on the following read.
        let events = Arc::new(events);
        loop {
            let batch = events.clone();
            match core.database(move |db| db.capture(&batch, missed)).await {
                Ok(queued) => {
                    core.problem(0, None);
                    if queued {
                        core.wake.notify_one();
                    }
                    if missed > 0 {
                        (core.changed)();
                    }
                    break;
                }
                Err(error) => core.problem(0, Some(error)),
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
}

async fn deliver(core: Arc<Core>) {
    let mut client = None;
    loop {
        let next = core.database(|db| db.next()).await;
        match next {
            Ok(Next::Wait(delay)) => {
                core.problem(1, None);
                if let Some(delay) = delay {
                    let _ = tokio::time::timeout(delay, core.wake.notified()).await;
                } else {
                    core.wake.notified().await;
                }
            }
            Ok(Next::Send(attempt)) => {
                let attempt = Arc::new(attempt);
                let result =
                    match client.get_or_insert_with(|| delivery::client(Duration::from_secs(10))) {
                        Ok(client) => delivery::send(client, &attempt).await,
                        Err(error) => Err(Failure {
                            message: error.clone(),
                            transient: false,
                        }),
                    };
                loop {
                    let job = attempt.clone();
                    let response = result.clone();
                    match core.database(move |db| db.settle(&job, &response)).await {
                        Ok(done) => {
                            core.problem(1, None);
                            if done && result.is_err() {
                                (core.changed)();
                            }
                            if done && attempt.kind == "webhook.test" {
                                (core.test_finished)(&attempt.hook, result.is_ok());
                            }
                            break;
                        }
                        Err(error) => core.problem(1, Some(error)),
                    }
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
            Err(error) => {
                core.problem(1, Some(error));
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
}
