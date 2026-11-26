// OS-facing services and app integrations used by commands and setup.
pub mod clipboard;
pub mod indexed_search;
pub mod opener;
pub mod preview_protocol;
#[cfg(windows)]
pub mod remotes;
pub mod shells;
pub mod transfer_manager;
pub mod watch;
