// Small shared time helpers for filesystem modules.
use std::time::SystemTime;

// Convert filesystem timestamps into epoch milliseconds for the UI.
pub(crate) fn to_epoch_ms(time: SystemTime) -> Option<u64> {
    // Use epoch milliseconds so the UI can format locally.
    time.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}
