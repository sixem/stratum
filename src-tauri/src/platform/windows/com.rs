// Shared COM apartment helpers for Windows-only integration code.
// Several shell-facing modules need an STA thread, so we centralize the
// setup here instead of duplicating the same guard in each caller.
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

pub struct StaComGuard;

impl StaComGuard {
    pub fn new() -> Result<Self, String> {
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        hr.ok().map_err(|err| err.to_string())?;
        Ok(Self)
    }
}

impl Drop for StaComGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
