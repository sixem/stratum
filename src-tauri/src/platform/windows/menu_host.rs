// Stratum loads third-party menu handlers in a separate copy of its executable.
// The helper starts only on demand. Paths travel over a pipe, so large selections
// and names containing quotes never pass through the command-line parser.
use crate::platform::ShellMenuOutcome;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, Prefix};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::Storage::FileSystem::GetDriveTypeW;
use windows::Win32::System::Threading::CREATE_NO_WINDOW;
use windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;

mod worker;

const HOST_SWITCH: &str = "--stratum-shell-menu-host";

type Reply = Result<ShellMenuOutcome, String>;

#[derive(Serialize, Deserialize)]
struct Request {
    source: isize,
    x: i32,
    y: i32,
    paths: Vec<String>,
    background: Option<String>,
    extended: bool,
    #[serde(default)]
    offer_gallery: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum Message {
    Show(Request),
    Warm { warm_folder: String },
}

pub(crate) fn run_if_requested() -> bool {
    if std::env::args_os().nth(1).as_deref() != Some(std::ffi::OsStr::new(HOST_SWITCH)) {
        return false;
    }
    if let Err(error) = worker::run() {
        eprintln!("Windows context menu host: {error}");
    }
    true
}

#[derive(Default)]
pub(crate) struct MenuHost {
    connection: Mutex<Option<Connection>>,
    warmed: Mutex<Option<Connection>>,
    warmup_attempted: AtomicBool,
    menu_requested: AtomicBool,
}

fn fixed_dos_path(path: &Path) -> bool {
    let Some(Component::Prefix(prefix)) = path.components().next() else {
        return false;
    };
    let Prefix::Disk(drive) = prefix.kind() else {
        return false;
    };
    const DRIVE_FIXED: u32 = 3;
    let root = [u16::from(drive), b':' as u16, b'\\' as u16, 0];
    path.is_absolute() && unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) } == DRIVE_FIXED
}

struct Connection {
    child: Child,
    input: BufWriter<ChildStdin>,
    output: BufReader<ChildStdout>,
}

impl Connection {
    fn start() -> io::Result<Self> {
        let mut child = Command::new(std::env::current_exe()?)
            .arg(HOST_SWITCH)
            .creation_flags(CREATE_NO_WINDOW.0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        Ok(Self {
            input: BufWriter::new(child.stdin.take().expect("piped stdin")),
            output: BufReader::new(child.stdout.take().expect("piped stdout")),
            child,
        })
    }

    fn exchange(&mut self, request: &Message) -> io::Result<Reply> {
        serde_json::to_writer(&mut self.input, request)?;
        self.input.write_all(b"\n")?;
        self.input.flush()?;
        let mut line = String::new();
        if self.output.read_line(&mut line)? == 0 {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "the Windows menu host exited",
            ));
        }
        Ok(serde_json::from_str(&line)?)
    }
}

impl MenuHost {
    pub(crate) fn warm(&self) {
        if self.menu_requested.load(Ordering::Relaxed)
            || self.warmup_attempted.swap(true, Ordering::Relaxed)
        {
            return;
        }
        // Use a local system folder without reading anything from the user's active view.
        let Some(folder) =
            std::env::var_os("SystemRoot").filter(|path| fixed_dos_path(Path::new(path)))
        else {
            return;
        };
        let Ok(mut candidate) = Connection::start() else {
            return;
        };
        if !matches!(
            candidate.exchange(&Message::Warm {
                warm_folder: folder.to_string_lossy().into_owned()
            }),
            Ok(Ok(ShellMenuOutcome::Dismissed))
        ) {
            return;
        }
        // Publish only after the Shell finishes. A click can start its own helper immediately.
        if let Ok(mut warmed) = self.warmed.lock() {
            if !self.menu_requested.load(Ordering::Relaxed) {
                *warmed = Some(candidate);
            }
        }
    }

    pub(crate) fn show(
        &self,
        window: HWND,
        paths: Vec<String>,
        background: Option<String>,
        mut point: POINT,
        extended: bool,
        offer_gallery: bool,
    ) -> Reply {
        unsafe { ClientToScreen(window, &mut point) }
            .ok()
            .map_err(|e| e.to_string())?;
        let request = Request {
            source: window.0 as isize,
            x: point.x,
            y: point.y,
            paths,
            background,
            extended,
            offer_gallery,
        };
        // A second click must not enqueue an unexpected popup behind the first.
        self.menu_requested.store(true, Ordering::Relaxed);
        let mut slot = self
            .connection
            .try_lock()
            .map_err(|_| "A Windows context menu is already open.")?;
        if slot.is_none() {
            *slot = self.warmed.lock().ok().and_then(|mut warmed| warmed.take());
        }
        if let Some(connection) = slot.as_mut() {
            if connection
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                *slot = None;
            }
        }
        let connection = match slot.as_mut() {
            Some(connection) => connection,
            None => slot.insert(Connection::start().map_err(|e| e.to_string())?),
        };
        // The helper owns the popup. Grant activation only for a real menu request.
        unsafe {
            let _ = AllowSetForegroundWindow(connection.child.id());
        }
        match connection.exchange(&Message::Show(request)) {
            Ok(reply) => reply,
            Err(error) => {
                // A handler may have already run. Retry only on the next user request.
                let _ = connection.child.kill();
                let _ = connection.child.wait();
                *slot = None;
                Err(format!("Windows context menu interrupted: {error}"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warmup_message_only_carries_the_folder_to_prepare() {
        let msg = Message::Warm {
            warm_folder: "C:\\Windows".into(),
        };
        let wire = serde_json::to_value(&msg).unwrap();
        assert_eq!(wire, serde_json::json!({ "warm_folder": "C:\\Windows" }));
        let received = serde_json::from_value::<Message>(wire).unwrap();
        assert!(matches!(received, Message::Warm { warm_folder } if warm_folder == "C:\\Windows"));
    }

    #[test]
    fn menu_host_protocol_carries_gallery_and_distinguishes_all_outcomes() {
        let mut request: Request = serde_json::from_value(serde_json::json!({
            "source": 1, "x": 2, "y": 3,
            "paths": ["C:\\fixture.jpg"], "extended": false,
        }))
        .unwrap();
        assert!(!request.offer_gallery);
        request.offer_gallery = true;
        let request: Request =
            serde_json::from_str(&serde_json::to_string(&request).unwrap()).unwrap();
        assert!(request.offer_gallery);
        for (outcome, label) in [
            (ShellMenuOutcome::Dismissed, "dismissed"),
            (ShellMenuOutcome::Invoked, "invoked"),
            (ShellMenuOutcome::Gallery, "gallery"),
        ] {
            let reply: Reply = Ok(outcome);
            let wire = serde_json::to_value(&reply).unwrap();
            assert_eq!(wire, serde_json::json!({ "Ok": label }));
            assert_eq!(serde_json::from_value::<Reply>(wire).unwrap(), reply);
        }
    }
}
