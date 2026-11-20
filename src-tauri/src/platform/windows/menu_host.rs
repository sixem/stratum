// Stratum loads third-party menu handlers in a separate copy of its executable.
// The helper starts only on demand. Paths travel over a pipe, so large selections
// and names containing quotes never pass through the command-line parser.
use crate::platform::ShellMenuOutcome;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::ClientToScreen;
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
pub(crate) struct MenuHost(Mutex<Option<Connection>>);

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

    fn exchange(&mut self, request: &Request) -> io::Result<Reply> {
        // The helper owns the popup so Windows can deliver the extension's menu
        // messages there. Grant activation for this user-initiated request.
        unsafe {
            let _ = AllowSetForegroundWindow(self.child.id());
        }
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
        let mut slot = self
            .0
            .try_lock()
            .map_err(|_| "A Windows context menu is already open.")?;
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
        match connection.exchange(&request) {
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
