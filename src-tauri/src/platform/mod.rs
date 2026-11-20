// Platform integrations that depend on the host OS.
pub mod drag;
pub mod dragdrop;

#[derive(Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ShellMenuOutcome {
    Dismissed,
    Invoked,
    Gallery,
}

#[cfg(target_os = "windows")]
pub mod windows;
