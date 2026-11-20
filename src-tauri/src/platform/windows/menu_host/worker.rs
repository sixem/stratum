// Keep one Shell STA pumping messages between requests. This lets modeless
// extension dialogs and delayed clipboard rendering continue after a menu closes.
use super::{Reply, Request};
use crate::platform::windows::shell_menu;
use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::os::windows::io::{AsHandle, AsRawHandle};
use std::sync::mpsc;
use windows::core::w;
use windows::Win32::Foundation::{
    SetHandleInformation, HANDLE, HANDLE_FLAGS, HANDLE_FLAG_INHERIT, HWND, LPARAM, POINT, WPARAM,
};
use windows::Win32::System::Console::{SetStdHandle, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
use windows::Win32::System::DataExchange::GetClipboardOwner;
use windows::Win32::System::Ole::{OleFlushClipboard, OleInitialize, OleUninitialize};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::HiDpi::{
    SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, DispatchMessageW, GetForegroundWindow, GetMessageW,
    GetWindowThreadProcessId, PostThreadMessageW, SetForegroundWindow, TranslateMessage, MSG,
    WM_APP, WM_QUIT, WS_EX_TOOLWINDOW, WS_POPUP,
};

const REQUEST_READY: u32 = WM_APP + 1;

pub(super) fn run() -> Result<(), String> {
    unsafe {
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        OleInitialize(None).map_err(|e| e.to_string())?;
    }
    let result = run_window();
    unsafe {
        OleUninitialize();
    }
    result
}

fn run_window() -> Result<(), String> {
    // Shell handlers can print or launch other applications. Give the protocol
    // private, non-inheritable handles before loading any third-party code.
    let stdin = io::stdin();
    let stdout = io::stdout();
    let input = File::from(
        stdin
            .as_handle()
            .try_clone_to_owned()
            .map_err(|e| e.to_string())?,
    );
    let output = File::from(
        stdout
            .as_handle()
            .try_clone_to_owned()
            .map_err(|e| e.to_string())?,
    );
    let nul = OpenOptions::new()
        .read(true)
        .write(true)
        .open("NUL")
        .map_err(|e| e.to_string())?;
    unsafe {
        for pipe in [stdin.as_raw_handle(), stdout.as_raw_handle()] {
            SetHandleInformation(HANDLE(pipe), HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0))
                .map_err(|e| e.to_string())?;
        }
        for standard in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE] {
            SetStdHandle(standard, HANDLE(nul.as_raw_handle())).map_err(|e| e.to_string())?;
        }
    }
    // A zero-sized top-level HWND owns the popup and the extension's dialogs.
    // It has its own input queue. The real app supplies the screen anchor.
    let proxy = unsafe {
        CreateWindowExW(
            WS_EX_TOOLWINDOW,
            w!("STATIC"),
            w!("Stratum Windows menu"),
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            None,
            None,
        )
    }
    .map_err(|e| e.to_string())?;
    let thread_id = unsafe { GetCurrentThreadId() };
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(input).lines() {
            let Ok(line) = line else {
                break;
            };
            if send.send(line).is_err() {
                break;
            }
            if unsafe { PostThreadMessageW(thread_id, REQUEST_READY, WPARAM(0), LPARAM(0)) }
                .is_err()
            {
                break;
            }
        }
        unsafe {
            let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    });
    let result = pump(proxy, &receive, output);
    unsafe {
        // Preserve clipboard data set by a Shell verb when Stratum exits.
        if let Ok(owner) = GetClipboardOwner() {
            let mut process = 0;
            GetWindowThreadProcessId(owner, Some(&mut process));
            if process == std::process::id() {
                let _ = OleFlushClipboard();
            }
        }
        let _ = DestroyWindow(proxy);
    }
    result
}

fn pump(proxy: HWND, receive: &mpsc::Receiver<String>, mut output: File) -> Result<(), String> {
    let mut msg = MSG::default();
    loop {
        // An extension dialog can consume the wake-up in its own modal loop.
        // The channel retains the request until we return to this outer loop.
        match receive.try_recv() {
            Ok(line) => {
                let reply = serde_json::from_str(&line)
                    .map_err(|e| e.to_string())
                    .and_then(|request| show(proxy, request));
                serde_json::to_writer(&mut output, &reply).map_err(|e| e.to_string())?;
                output
                    .write_all(b"\n")
                    .and_then(|_| output.flush())
                    .map_err(|e| e.to_string())?;
                continue;
            }
            Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
            Err(mpsc::TryRecvError::Empty) => {}
        }
        let status = unsafe { GetMessageW(&mut msg, None, 0, 0) }.0;
        if status == 0 {
            return Ok(());
        }
        if status == -1 {
            return Err(windows::core::Error::from_win32().to_string());
        }
        if !(msg.hwnd.is_invalid() && msg.message == REQUEST_READY) {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}

fn show(proxy: HWND, request: Request) -> Reply {
    let source = HWND(request.source as _);
    let reply = shell_menu::show(
        proxy,
        source,
        &request.paths,
        request.background.as_deref(),
        POINT {
            x: request.x,
            y: request.y,
        },
        request.extended,
        request.offer_gallery,
    );
    if unsafe { GetForegroundWindow() } == proxy {
        unsafe {
            let _ = SetForegroundWindow(source);
        }
    }
    reply
}
