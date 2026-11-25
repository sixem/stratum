use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Read};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Location {
    pub(super) version: u32,
    pub(super) path: Option<String>,
    #[serde(default)]
    pub(super) error: Option<String>,
}

// Directory names are data in a private per-session mailbox. No path or command
// from the folder view is written to the terminal input stream.
pub(super) struct DirectoryBridge {
    root: PathBuf,
    watcher: Option<RecommendedWatcher>,
    linked_version: Mutex<u32>,
}

fn is_filesystem_path(path: &str) -> bool {
    Path::new(path).is_absolute() && !path.contains('\0') && path.len() <= 32767 * 4
}

impl DirectoryBridge {
    pub fn new(on_location: impl Fn(Location) + Send + 'static) -> io::Result<Self> {
        let mut token = [0u8; 16];
        getrandom::fill(&mut token).map_err(|e| io::Error::other(e.to_string()))?;
        let root =
            std::env::temp_dir().join(format!("stratum-shell-{:032x}", u128::from_le_bytes(token)));
        fs::create_dir(&root)?;
        let mut bridge = Self {
            root,
            watcher: None,
            linked_version: Mutex::new(0),
        };
        fs::write(bridge.root.join("signal"), [])?;

        // Watch before the shell starts so the first prompt can report its directory.
        let report = bridge.root.join("report");
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if !event.is_ok_and(|event| event.paths.iter().any(|path| path == &report)) {
                    return;
                }
                let Ok(file) = fs::File::open(&report) else {
                    return;
                };
                if let Ok(location) = serde_json::from_reader::<_, Location>(file.take(256 * 1024))
                {
                    if location.path.as_deref().is_some_and(is_filesystem_path) {
                        on_location(location);
                    }
                }
            })
            .map_err(io::Error::other)?;
        watcher
            .watch(&bridge.root, RecursiveMode::NonRecursive)
            .map_err(io::Error::other)?;
        bridge.watcher = Some(watcher);
        Ok(bridge)
    }

    pub fn arguments(&self) -> String {
        let units = self
            .root
            .as_os_str()
            .encode_wide()
            .map(|unit| unit.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let script = include_str!("directory.ps1").replace("__MAILBOX__", &units);
        format!("-NoLogo -NoExit -Command \"{script}\"")
    }

    pub fn update_link(&self, version: u32, path: Option<String>) -> Result<(), String> {
        let mut linked_version = self.linked_version.lock().unwrap();
        if version <= *linked_version {
            return Ok(());
        }
        if path
            .as_deref()
            .is_some_and(|path| !is_filesystem_path(path))
        {
            return Err("Invalid folder path.".into());
        }
        let request = serde_json::to_vec(&Location {
            version,
            path,
            error: None,
        })
        .map_err(|e| e.to_string())?;
        let temp = self.root.join("request.tmp");
        fs::write(&temp, request)
            .and_then(|_| fs::rename(temp, self.root.join("request")))
            .and_then(|_| fs::write(self.root.join("signal"), version.to_le_bytes()))
            .map_err(|e| e.to_string())?;
        *linked_version = version;
        Ok(())
    }
}

impl Drop for DirectoryBridge {
    fn drop(&mut self) {
        self.watcher.take();
        // Remove only our own files, even if a child wrote something unexpected.
        for name in [
            "signal",
            "request",
            "request.tmp",
            "request.read",
            "report",
            "report.tmp",
        ] {
            let _ = fs::remove_file(self.root.join(name));
        }
        let _ = fs::remove_dir(&self.root);
    }
}
