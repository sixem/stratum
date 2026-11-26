// The main window can request a release by version. Only native code chooses the
// endpoint, installer URL and signature verification key.
use crate::services::transfer_manager::{TransferManagerHandle, TransferShutdownMode};
use serde::Serialize;
use std::time::Duration;
use tauri::{utils::config::BundleType, AppHandle, Manager, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};

const PUBLIC_KEY: Option<&str> = option_env!("STRATUM_UPDATER_PUBLIC_KEY");
const CHANGED: &str = "This update is no longer available. Check again for the current release.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Action {
    Install,
    Portable,
    Msi,
}

fn action(bundle: Option<BundleType>) -> Action {
    match bundle {
        Some(BundleType::Nsis) => Action::Install,
        Some(BundleType::Msi) => Action::Msi,
        _ => Action::Portable,
    }
}

fn asset_url(version: &str, action: Action) -> String {
    let suffix = match action {
        Action::Install => "x64-setup.exe",
        Action::Portable => "portable.exe",
        Action::Msi => "x64_en-US.msi",
    };
    format!(
        "https://github.com/sixem/stratum/releases/download/v{version}/Stratum_{version}_{suffix}"
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Offer {
    version: String,
    published_at: String,
    notes: String,
    action: Action,
}

async fn latest(webview: &Webview) -> Result<Option<(Offer, Update)>, String> {
    if webview.label() != "main" {
        return Err("Updates are unavailable in this window.".into());
    }
    let key = PUBLIC_KEY
        .filter(|key| !key.trim().is_empty())
        .ok_or("Update checks are unavailable in this build.")?;
    let app = webview.app_handle().clone();
    let updater = webview
        .app_handle()
        .updater_builder()
        .pubkey(key.trim())
        .timeout(Duration::from_secs(15))
        .on_before_exit(move || {
            // Windows installer handoff bypasses Tauri's usual ExitRequested event.
            app.state::<crate::services::indexed_search::IndexedSearchHandle>()
                .shutdown();
            // Keep the window usable if Windows refuses to launch the installer.
        })
        .header("Cache-Control", "no-cache")
        .and_then(|builder| builder.build())
        .map_err(|e| e.to_string())?;
    let Some(mut update) = updater
        .check()
        .await
        .map_err(|_| "Could not check the update feed.")?
    else {
        return Ok(None);
    };
    // Tauri parses SemVer and RFC 3339 before exposing Update. The stable channel
    // accepts only ordinary release versions and this repository's NSIS artifact.
    if !update
        .version
        .bytes()
        .all(|c| c.is_ascii_digit() || c == b'.')
        || update.download_url.as_str() != asset_url(&update.version, Action::Install)
        || update.date.is_none()
    {
        return Err("The update feed contains invalid release details.".into());
    }
    let published_at = update.raw_json["pub_date"]
        .as_str()
        .ok_or("The release publication date is missing.")?
        .to_owned();
    let offer = Offer {
        version: update.version.clone(),
        published_at,
        notes: update.body.clone().unwrap_or_default(),
        action: action(tauri::utils::platform::bundle_type()),
    };
    update.timeout = Some(Duration::from_secs(180));
    Ok(Some((offer, update)))
}

#[tauri::command]
pub(crate) async fn check_app_update(webview: Webview) -> Result<Option<Offer>, String> {
    Ok(latest(&webview).await?.map(|(offer, _)| offer))
}

async fn current_offer(
    webview: &Webview,
    version: &str,
    date: &str,
) -> Result<(Offer, Update), String> {
    latest(webview)
        .await?
        .filter(|(offer, _)| offer.version == version && offer.published_at == date)
        .ok_or_else(|| CHANGED.to_owned())
}

#[tauri::command]
pub(crate) async fn apply_app_update(
    webview: Webview,
    app: AppHandle,
    version: String,
    published_at: String,
    confirmed_terminals: Option<bool>,
) -> Result<(), String> {
    let (offer, update) = current_offer(&webview, &version, &published_at).await?;
    if offer.action != Action::Install {
        return tauri_plugin_opener::open_url(asset_url(&version, offer.action), None::<&str>)
            .map_err(|e| e.to_string());
    }
    let confirmed = confirmed_terminals.unwrap_or(false);
    #[cfg(windows)]
    let terminals = app.state::<crate::platform::windows::terminal::Terminals>();
    #[cfg(windows)]
    if !confirmed && terminals.requires_confirmation() {
        return Err("terminal-confirmation-required".into());
    }

    // Download verifies the artifact and signed version. The second check catches
    // withdrawals or replacement signatures while a slow download was in flight.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|_| "Could not download and verify the installer.")?;
    let (_, refreshed) = current_offer(&webview, &version, &published_at).await?;
    if refreshed.signature != update.signature {
        return Err(CHANGED.into());
    }
    let transfers = app.state::<TransferManagerHandle>();
    let ticket = transfers
        .begin_shutdown(TransferShutdownMode::IdleOnly)?
        .ok_or("Finish active file operations before installing the update.")?;
    #[cfg(windows)]
    if let Err(error) = terminals.reserve_update(confirmed) {
        transfers.reopen_queue(ticket)?;
        return Err(error);
    }
    // On Windows successful handoff exits the process. Restore both gates if it fails.
    let result = update.install(bytes).map_err(|e| e.to_string());
    #[cfg(windows)]
    terminals.cancel_update();
    transfers.reopen_queue(ticket)?;
    app.state::<crate::services::indexed_search::IndexedSearchHandle>()
        .resume_after_failed_update();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_actions_match_the_embedded_bundle_marker() {
        assert_eq!(action(Some(BundleType::Nsis)), Action::Install);
        assert_eq!(action(Some(BundleType::Msi)), Action::Msi);
        assert_eq!(action(None), Action::Portable);
        assert!(
            asset_url("0.2.5", Action::Portable).ends_with("/v0.2.5/Stratum_0.2.5_portable.exe")
        );
    }
}
