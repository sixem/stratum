// Only the bundled application or the configured dev server may host the IPC UI.
use tauri::{plugin::TauriPlugin, Manager, Runtime, Url, Webview};

pub(crate) fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("app-navigation")
        .on_navigation(allows_app_navigation)
        .build()
}

pub(crate) fn allows_app_navigation<R: Runtime>(webview: &Webview<R>, url: &Url) -> bool {
    let config = webview.config();
    let dev_url = config.build.dev_url.as_ref().filter(|_| tauri::is_dev());
    let use_https = config
        .app
        .windows
        .iter()
        .find(|window| window.label == webview.label())
        .is_some_and(|window| window.use_https_scheme);
    is_app_navigation(url, dev_url, use_https)
}

fn is_app_navigation(url: &Url, dev_url: Option<&Url>, use_https: bool) -> bool {
    if let Some(dev_url) = dev_url {
        return url.origin() == dev_url.origin();
    }

    let scheme = if use_https { "https" } else { "http" };
    // WebView2 maps Tauri's bundled protocol to this origin. Media and cache
    // protocols can still load as subresources of the app.
    url.scheme() == scheme && url.host_str() == Some("tauri.localhost") && url.port().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_bundled_origin_can_host_the_production_ui() {
        let url = |value| Url::parse(value).unwrap();
        assert!(is_app_navigation(
            &url("http://tauri.localhost/index.html"),
            None,
            false
        ));
        assert!(is_app_navigation(
            &url("https://tauri.localhost/index.html"),
            None,
            true
        ));
        for other in [
            "https://example.com",
            "http://tauri.localhost:1420",
            "http://stratum-preview.localhost",
        ] {
            assert!(!is_app_navigation(&url(other), None, false));
        }
    }

    #[test]
    fn development_uses_the_configured_dev_server_origin() {
        let dev = Url::parse("http://127.0.0.1:1420").unwrap();
        assert!(is_app_navigation(
            &dev.join("index.html").unwrap(),
            Some(&dev),
            false
        ));
        let other = Url::parse("http://127.0.0.1:1421/").unwrap();
        assert!(!is_app_navigation(&other, Some(&dev), false));
    }
}
