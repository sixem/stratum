use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Read};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Location {
    version: u32,
    path: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Default)]
struct Link {
    version: u32,
    watcher: Option<RecommendedWatcher>,
    channel: Arc<Mutex<Option<Channel<Location>>>>,
}

// Directory names are data in a private per-session mailbox. No path or command
// from the folder view is written to the terminal input stream.
pub(super) struct DirectoryBridge {
    root: PathBuf,
    link: Mutex<Link>,
}

impl DirectoryBridge {
    pub fn new() -> io::Result<Self> {
        let mut token = [0u8; 16];
        getrandom::fill(&mut token).map_err(|e| io::Error::other(e.to_string()))?;
        let root =
            std::env::temp_dir().join(format!("stratum-shell-{:032x}", u128::from_le_bytes(token)));
        fs::create_dir(&root)?;
        let bridge = Self {
            root,
            link: Mutex::default(),
        };
        fs::write(bridge.root.join("signal"), [])?;
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

    pub fn update(
        &self,
        version: u32,
        path: Option<String>,
        channel: Channel<Location>,
    ) -> Result<(), String> {
        let mut link = self.link.lock().unwrap();
        if version <= link.version {
            return Ok(());
        }
        if let Some(dir) = &path {
            if !Path::new(dir).is_absolute() || dir.contains('\0') || dir.len() > 32767 * 4 {
                return Err("Invalid folder path.".into());
            }
            if link.watcher.is_none() {
                let report = self.root.join("report");
                let recipient = link.channel.clone();
                let mut watcher =
                    notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                        if !event.is_ok_and(|e| e.paths.iter().any(|p| p == &report)) {
                            return;
                        }
                        let Ok(file) = fs::File::open(&report) else {
                            return;
                        };
                        if let Ok(location) =
                            serde_json::from_reader::<_, Location>(file.take(256 * 1024))
                        {
                            if !location.path.as_ref().is_some_and(|dir| {
                                Path::new(dir).is_absolute() && !dir.contains('\0')
                            }) {
                                return;
                            }
                            if let Some(channel) = recipient.lock().unwrap().as_ref() {
                                let _ = channel.send(location);
                            }
                        }
                    })
                    .map_err(|e| e.to_string())?;
                watcher
                    .watch(&self.root, RecursiveMode::NonRecursive)
                    .map_err(|e| e.to_string())?;
                link.watcher = Some(watcher);
            }
            *link.channel.lock().unwrap() = Some(channel);
        } else {
            link.watcher = None;
            link.channel.lock().unwrap().take();
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
        link.version = version;
        Ok(())
    }
}

impl Drop for DirectoryBridge {
    fn drop(&mut self) {
        self.link.get_mut().unwrap().watcher.take();
        // Remove only our own files, even if a child wrote something unexpected.
        for name in ["signal", "request", "request.tmp", "report", "report.tmp"] {
            let _ = fs::remove_file(self.root.join(name));
        }
        let _ = fs::remove_dir(&self.root);
    }
}
