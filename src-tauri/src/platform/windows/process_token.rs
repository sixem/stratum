// Check the current process token before launching user-configured tools.
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

pub(crate) fn is_process_elevated() -> windows::core::Result<bool> {
    let mut token = HANDLE::default();
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)? };

    let mut elevation = TOKEN_ELEVATION::default();
    let mut return_len = 0;
    let result = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut return_len,
        )
    };
    unsafe {
        let _ = CloseHandle(token);
    }

    result?;
    Ok(elevation.TokenIsElevated != 0)
}

pub(crate) fn require_standard_token_for_tools() -> Result<(), String> {
    match is_process_elevated() {
        Ok(false) => Ok(()),
        Ok(true) => Err("Shells and FFmpeg are unavailable while Stratum runs as administrator. Restart Stratum without elevation to use them.".into()),
        Err(error) => Err(format!("Could not verify Stratum’s privileges before launching an external tool: {error}")),
    }
}
