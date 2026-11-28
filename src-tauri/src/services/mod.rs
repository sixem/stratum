// OS-facing services and app integrations used by commands and setup.
pub mod clipboard;
pub mod indexed_search;
pub mod opener;
// Producers share this internal stream. Subscriber-facing types also serve future consumers.
#[cfg_attr(not(test), expect(dead_code))]
pub(crate) mod operation_events;
pub mod preview_protocol;
#[cfg(windows)]
pub mod remotes;
pub mod shells;
pub mod transfer_manager;
pub mod watch;
#[cfg(windows)]
pub(crate) mod webhooks;
