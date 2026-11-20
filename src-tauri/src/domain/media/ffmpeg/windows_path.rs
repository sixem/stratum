// A GUI process inherits a snapshot of PATH. Installers can update either
// registry value while Stratum (or its launcher) is already running.
use std::env;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use windows::core::{w, PCWSTR};
use windows::Win32::System::Registry::{
    RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ,
};

fn environment_path(key: HKEY, subkey: PCWSTR) -> Option<OsString> {
    let mut buffer = vec![0u16; 32768];
    let mut bytes = (buffer.len() * 2) as u32;
    unsafe {
        RegGetValueW(
            key,
            subkey,
            w!("Path"),
            RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut bytes),
        )
    }
    .ok()
    .ok()?;
    let data = buffer.get(..bytes as usize / 2)?;
    Some(OsString::from_wide(data.strip_suffix(&[0]).unwrap_or(data)))
}

pub(super) fn append_install_dirs(dirs: &mut Vec<PathBuf>) {
    for (key, subkey) in [
        (
            HKEY_LOCAL_MACHINE,
            w!("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"),
        ),
        (HKEY_CURRENT_USER, w!("Environment")),
    ] {
        if let Some(value) = environment_path(key, subkey) {
            dirs.extend(env::split_paths(&value));
        }
    }
    if let Some(programs) = env::var_os("ProgramFiles") {
        dirs.push(PathBuf::from(programs).join("ffmpeg").join("bin"));
    }
}
