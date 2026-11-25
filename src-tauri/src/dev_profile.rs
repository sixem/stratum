// Select an isolated app identifier before Tauri opens the profile lock or WebView.
pub(super) fn configure(mut context: tauri::Context<tauri::Wry>) -> tauri::Context<tauri::Wry> {
    if !tauri::is_dev() {
        return context;
    }

    let args = std::env::args_os();
    let identifier = args
        .filter_map(|arg| arg.into_string().ok())
        .find_map(|arg| {
            arg.strip_prefix("--stratum-dev-profile=")
                .map(str::to_owned)
        });
    if let Some(identifier) = identifier {
        let suffix = identifier.strip_prefix("com.emy.stratum.dev-fresh-");
        assert!(
            suffix.is_some_and(
                |suffix| suffix.len() == 32 && suffix.bytes().all(|b| b.is_ascii_hexdigit())
            ),
            "The fresh profile identifier is invalid"
        );
        context.config_mut().identifier = identifier;
    }
    context
}
