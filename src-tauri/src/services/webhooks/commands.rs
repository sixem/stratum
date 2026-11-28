// Only the main application webview may configure delivery or inspect unresolved work.
use super::{
    payload::EVENT_TYPES,
    store::{Edit, Hook},
    work::Work,
    Engine, Webhooks,
};
use serde::Serialize;
use tauri::{Manager, Webview};

async fn with_engine<T: Send + 'static>(
    webview: Webview,
    f: impl FnOnce(&Engine) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    if webview.label() != "main" {
        return Err("Webhooks are available in the main window.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = webview.state::<Webhooks>();
        f(state.0.as_ref().map_err(Clone::clone)?)
    })
    .await
    .map_err(|_| "The webhook settings worker stopped.".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Settings {
    hooks: Vec<Hook>,
    event_types: &'static [&'static str],
}

#[tauri::command]
pub(crate) async fn webhook_settings(webview: Webview) -> Result<Settings, String> {
    with_engine(webview, move |e| {
        Ok(Settings {
            hooks: e.core.store()?.hooks.clone(),
            event_types: EVENT_TYPES,
        })
    })
    .await
}
#[tauri::command]
pub(crate) async fn webhook_save(webview: Webview, edit: Edit) -> Result<(), String> {
    with_engine(webview, move |e| e.configure(|db| db.save(edit))).await
}
#[tauri::command]
pub(crate) async fn webhook_remove(webview: Webview, id: String) -> Result<(), String> {
    with_engine(webview, move |e| e.configure(|db| db.remove(&id))).await
}
#[tauri::command]
pub(crate) async fn webhook_test(webview: Webview, id: String) -> Result<(), String> {
    with_engine(webview, move |e| {
        e.core.store()?.test_event(&id)?;
        e.core.wake.notify_one();
        Ok(())
    })
    .await
}
#[tauri::command]
pub(crate) async fn webhook_work(webview: Webview) -> Result<Work, String> {
    with_engine(webview, move |e| {
        let mut work = e.core.store()?.work()?;
        work.error = e
            .core
            .errors
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .flatten()
            .next()
            .cloned();
        Ok(work)
    })
    .await
}
#[tauri::command]
pub(crate) async fn webhook_retry(webview: Webview, id: i64) -> Result<(), String> {
    with_engine(webview, move |e| {
        e.core.store()?.retry(id)?;
        e.core.wake.notify_one();
        (e.core.changed)();
        Ok(())
    })
    .await
}
#[tauri::command]
pub(crate) async fn webhook_dismiss(webview: Webview, id: Option<i64>) -> Result<(), String> {
    with_engine(webview, move |e| {
        e.core.store()?.dismiss(id)?;
        (e.core.changed)();
        Ok(())
    })
    .await
}
