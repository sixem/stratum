// Native process and pipe handles are owned from creation through shutdown.
use std::ffi::{c_void, OsStr, OsString};
use std::io::{self, PipeReader, PipeWriter};
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::Path;
use std::ptr::{null, null_mut};
use windows_sys::Win32::System::{Console::*, JobObjects::*, Threading::*};

pub(super) struct Console(HPCON);

fn size(cols: u16, rows: u16) -> io::Result<COORD> {
    if !(2..=512).contains(&cols) || !(1..=256).contains(&rows) {
        return Err(io::Error::other("Invalid terminal dimensions."));
    }
    Ok(COORD {
        X: cols as i16,
        Y: rows as i16,
    })
}

fn hresult(value: i32) -> io::Result<()> {
    if value < 0 {
        Err(io::Error::from_raw_os_error(value & 0xffff))
    } else {
        Ok(())
    }
}

impl Console {
    pub(super) fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        hresult(unsafe { ResizePseudoConsole(self.0, size(cols, rows)?) })
    }
}

impl Drop for Console {
    fn drop(&mut self) {
        unsafe { ClosePseudoConsole(self.0) }
    }
}

struct Attributes(Vec<usize>);

impl Attributes {
    fn new() -> io::Result<Self> {
        let mut bytes = 0;
        unsafe { InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut bytes) };
        let mut storage = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        if unsafe {
            InitializeProcThreadAttributeList(storage.as_mut_ptr().cast(), 2, 0, &mut bytes)
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(storage))
    }

    fn set(&mut self, attribute: u32, value: *const c_void) -> io::Result<()> {
        if unsafe {
            UpdateProcThreadAttribute(
                self.0.as_mut_ptr().cast(),
                0,
                attribute as usize,
                value,
                size_of::<isize>(),
                null_mut(),
                null(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.0.as_mut_ptr().cast()) }
    }
}

fn wide(value: &OsStr) -> io::Result<Vec<u16>> {
    let mut encoded: Vec<_> = value.encode_wide().collect();
    if encoded.contains(&0) {
        return Err(io::Error::other("Invalid path."));
    }
    encoded.push(0);
    Ok(encoded)
}

pub(super) struct Process {
    pub console: Console,
    pub job: OwnedHandle,
    pub child: OwnedHandle,
    pub input: PipeWriter,
    pub output: PipeReader,
}

// Only internal callers supply the executable and constant arguments. The working
// directory always travels in its own CreateProcessW parameter.
pub(super) fn spawn(
    exe: &Path,
    flags: &str,
    cwd: &Path,
    cols: u16,
    rows: u16,
) -> io::Result<Process> {
    let mut line = OsString::from("\"");
    line.push(exe);
    line.push("\" ");
    line.push(flags);
    let mut line = wide(&line)?;
    let exe = wide(exe.as_os_str())?;
    let cwd = wide(cwd.as_os_str())?;
    let (read, input) = io::pipe()?;
    let (output, write) = io::pipe()?;
    let mut hpc = 0;
    hresult(unsafe {
        CreatePseudoConsole(
            size(cols, rows)?,
            read.as_raw_handle() as _,
            write.as_raw_handle() as _,
            0,
            &mut hpc,
        )
    })?;
    let console = Console(hpc);
    drop((read, write));

    let raw_job = unsafe { CreateJobObjectW(null(), null()) };
    if raw_job == 0 {
        return Err(io::Error::last_os_error());
    }
    let job = unsafe { OwnedHandle::from_raw_handle(raw_job as _) };
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            raw_job,
            JobObjectExtendedLimitInformation,
            std::ptr::from_ref(&limits).cast(),
            size_of_val(&limits) as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let mut attrs = Attributes::new()?;
    attrs.set(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, hpc as _)?;
    attrs.set(
        PROC_THREAD_ATTRIBUTE_JOB_LIST,
        (&raw_job as *const isize).cast(),
    )?;
    let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    // Null standard handles select this console even if the host has redirected I/O.
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.lpAttributeList = attrs.0.as_mut_ptr().cast();
    let mut info = unsafe { zeroed::<PROCESS_INFORMATION>() };
    if unsafe {
        CreateProcessW(
            exe.as_ptr(),
            line.as_mut_ptr(),
            null(),
            null(),
            0,
            EXTENDED_STARTUPINFO_PRESENT,
            null(),
            cwd.as_ptr(),
            &startup.StartupInfo,
            &mut info,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let child = unsafe { OwnedHandle::from_raw_handle(info.hProcess as _) };
    drop(unsafe { OwnedHandle::from_raw_handle(info.hThread as _) });
    Ok(Process {
        console,
        job,
        child,
        input,
        output,
    })
}
