// Keep Recycle Bin identities on the backend for the current Undo session.
use super::super::fs_recycle_windows::RecycleEntry;
use std::collections::VecDeque;
use std::sync::Mutex;

// Match the frontend undo stack and retain only the most recent operations.
const MAX_RECEIPTS: usize = 20;
static RECEIPTS: Mutex<VecDeque<(String, Vec<RecycleEntry>)>> = Mutex::new(VecDeque::new());

pub(super) fn issue(entries: Vec<RecycleEntry>) -> Option<String> {
    if entries.is_empty() {
        return None;
    }
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).ok()?;
    let receipt = format!("{:032x}", u128::from_ne_bytes(bytes));
    remember(receipt.clone(), entries).then_some(receipt)
}

pub(super) fn take(receipt: &str) -> Option<Vec<RecycleEntry>> {
    let mut saved = RECEIPTS.lock().ok()?;
    let index = saved.iter().position(|(id, _)| id == receipt)?;
    saved.remove(index).map(|(_, entries)| entries)
}

pub(super) fn remember(receipt: String, entries: Vec<RecycleEntry>) -> bool {
    if entries.is_empty() {
        return false;
    }
    let Ok(mut saved) = RECEIPTS.lock() else {
        return false;
    };
    if saved.iter().any(|(id, _)| *id == receipt) {
        return false;
    }
    if saved.len() == MAX_RECEIPTS {
        saved.pop_front();
    }
    saved.push_back((receipt, entries));
    true
}
