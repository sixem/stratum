// A bounded pull stream lets a slow or hidden WebView apply backpressure to ConPTY.
mod directory;
pub(crate) mod fonts;
mod process;
use std::collections::HashMap;
use std::io::{PipeWriter, Read, Write};
use std::os::windows::io::{AsRawHandle, OwnedHandle};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{
    ipc::{Channel, Response},
    State, Webview,
};
use tokio::sync::{mpsc, Mutex as AsyncMutex};
use windows_sys::Win32::System::{JobObjects::TerminateJobObject, Threading::WaitForSingleObject};

const CHUNK: usize = 32 * 1024;
const MAX_SESSIONS: usize = 16;

struct Session {
    directory: Option<directory::DirectoryBridge>,
    job: Arc<OwnedHandle>,
    console: Arc<Mutex<Option<process::Console>>>,
    input: Arc<AsyncMutex<PipeWriter>>,
    output: AsyncMutex<mpsc::Receiver<Vec<u8>>>,
}

impl Drop for Session {
    fn drop(&mut self) {
        stop(self);
    }
}

impl Session {
    fn new(process: process::Process) -> Self {
        let process::Process {
            console,
            job,
            child,
            input,
            mut output,
        } = process;
        let job = Arc::new(job);
        let console = Arc::new(Mutex::new(Some(console)));
        let (tx, rx) = mpsc::channel(2);
        std::thread::spawn(move || {
            let mut buffer = [0u8; CHUNK];
            while let Ok(n) = output.read(&mut buffer) {
                if n == 0 {
                    break;
                }
                if tx.blocking_send(buffer[..n].to_vec()).is_err() {
                    // ClosePseudoConsole can wait for the client to drain final output.
                    let _ = std::io::copy(&mut output, &mut std::io::sink());
                    break;
                }
            }
        });
        let closing_console = console.clone();
        let closing_job = job.clone();
        std::thread::spawn(move || {
            unsafe {
                WaitForSingleObject(child.as_raw_handle() as _, u32::MAX);
                TerminateJobObject(closing_job.as_raw_handle() as _, 1);
            }
            let console = closing_console.lock().unwrap().take();
            drop(console);
        });
        Self {
            directory: None,
            job,
            console,
            input: Arc::new(AsyncMutex::new(input)),
            output: AsyncMutex::new(rx),
        }
    }
}

#[derive(Default)]
struct Registry {
    next: u32,
    installing_update: bool,
    sessions: HashMap<u32, Option<Arc<Session>>>,
}

#[derive(Default)]
pub(crate) struct Terminals(Mutex<Registry>);

impl Terminals {
    // Hold the reservation through installer launch, including shells still spawning.
    pub(crate) fn reserve_update(&self, confirmed: bool) -> Result<(), String> {
        let mut registry = self.0.lock().map_err(|_| "Terminal state unavailable.")?;
        if !confirmed && !registry.sessions.is_empty() {
            return Err("terminal-confirmation-required".into());
        }
        registry.installing_update = true;
        Ok(())
    }

    pub(crate) fn cancel_update(&self) {
        self.0.lock().unwrap().installing_update = false;
    }

    pub(crate) fn requires_confirmation(&self) -> bool {
        !self.0.lock().unwrap().sessions.is_empty()
    }

    pub(crate) fn clear(&self, label: &str) {
        if label == "main" {
            let sessions = std::mem::take(&mut self.0.lock().unwrap().sessions);
            for session in sessions.values().flatten() {
                stop(session);
            }
        }
    }
    fn get(&self, webview: &Webview, id: u32) -> Result<Arc<Session>, String> {
        owner(webview)?;
        self.0
            .lock()
            .unwrap()
            .sessions
            .get(&id)
            .and_then(Option::as_ref)
            .cloned()
            .ok_or_else(|| "Terminal closed.".into())
    }
}

// Wake pending reads/writes even when they still hold a reference to the session.
fn stop(session: &Session) {
    unsafe {
        TerminateJobObject(session.job.as_raw_handle() as _, 1);
    }
}

fn owner(webview: &Webview) -> Result<(), String> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err("Unavailable in this window.".into())
    }
}

#[derive(serde::Serialize)]
pub(crate) struct OpenedTerminal {
    id: u32,
    directory: String,
}

#[tauri::command]
pub(crate) async fn terminal_open(
    webview: Webview,
    state: State<'_, Terminals>,
    directory: String,
    cols: u16,
    rows: u16,
    location: Channel<directory::Location>,
) -> Result<OpenedTerminal, String> {
    owner(&webview)?;
    let id = {
        let mut registry = state.0.lock().unwrap();
        if registry.installing_update {
            return Err("Stratum is restarting for an update.".into());
        }
        if registry.sessions.len() >= MAX_SESSIONS {
            return Err("Close a terminal before opening another.".into());
        }
        registry.next = registry
            .next
            .checked_add(1)
            .ok_or("Terminal ID limit reached.")?;
        let id = registry.next;
        registry.sessions.insert(id, None);
        id
    };
    let opened = tauri::async_runtime::spawn_blocking(move || {
        open(directory, cols, rows, move |report| {
            let _ = location.send(report);
        })
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    let mut registry = state.0.lock().unwrap();
    match opened {
        Ok((session, directory)) => {
            // A reload or window close also invalidates opens still in flight.
            let slot = registry.sessions.get_mut(&id).ok_or("Terminal closed.")?;
            *slot = Some(Arc::new(session));
            Ok(OpenedTerminal { id, directory })
        }
        Err(error) => {
            registry.sessions.remove(&id);
            Err(error)
        }
    }
}

fn open(
    directory: String,
    cols: u16,
    rows: u16,
    on_location: impl Fn(directory::Location) + Send + 'static,
) -> Result<(Session, String), String> {
    super::process_token::require_standard_token_for_tools()?;
    let directory = if directory.is_empty() {
        crate::domain::filesystem::get_home()
            .ok_or("Home folder unavailable.")?
            .into()
    } else {
        PathBuf::from(directory)
    };
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("Working folder unavailable.".into());
    }
    let exe = crate::services::shells::powershell_path().ok_or("PowerShell is unavailable.")?;
    let bridge = directory::DirectoryBridge::new(on_location).ok();
    let flags = bridge.as_ref().map(|bridge| bridge.arguments());
    let process = process::spawn(
        &exe,
        flags.as_deref().unwrap_or("-NoLogo"),
        &directory,
        cols,
        rows,
    )
    .map_err(|e| e.to_string())?;
    let mut session = Session::new(process);
    session.directory = bridge;
    Ok((session, directory.to_string_lossy().into_owned()))
}

#[tauri::command]
pub(crate) async fn terminal_link_directory(
    webview: Webview,
    state: State<'_, Terminals>,
    id: u32,
    version: u32,
    path: Option<String>,
) -> Result<(), String> {
    let session = state.get(&webview, id)?;
    tauri::async_runtime::spawn_blocking(move || {
        session
            .directory
            .as_ref()
            .ok_or("PowerShell directory linking is unavailable.")?
            .update_link(version, path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn terminal_read(
    webview: Webview,
    state: State<'_, Terminals>,
    id: u32,
) -> Result<Response, String> {
    let session = state.get(&webview, id)?;
    let mut reader = session
        .output
        .try_lock()
        .map_err(|_| "Read already pending.")?;
    Ok(Response::new(reader.recv().await.unwrap_or_default()))
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
pub(crate) enum TerminalInput {
    Text(String),
    Bytes(Vec<u8>),
}

#[tauri::command]
pub(crate) async fn terminal_write(
    webview: Webview,
    state: State<'_, Terminals>,
    id: u32,
    data: TerminalInput,
) -> Result<(), String> {
    let data = match data {
        TerminalInput::Text(text) => text.into_bytes(),
        TerminalInput::Bytes(bytes) => bytes,
    };
    if data.len() > CHUNK {
        return Err("Terminal input too large.".into());
    }
    let session = state.get(&webview, id)?;
    let mut input = session
        .input
        .clone()
        .try_lock_owned()
        .map_err(|_| "Write already pending.")?;
    tauri::async_runtime::spawn_blocking(move || input.write_all(&data))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn terminal_resize(
    webview: Webview,
    state: State<'_, Terminals>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = state.get(&webview, id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let console = session.console.lock().unwrap();
        if let Some(console) = console.as_ref() {
            console.resize(cols, rows).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn terminal_close(
    webview: Webview,
    state: State<Terminals>,
    id: u32,
) -> Result<(), String> {
    owner(&webview)?;
    if let Some(Some(session)) = state.0.lock().unwrap().sessions.remove(&id) {
        stop(&session);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
