// SFTP v3 framing over an authenticated OpenSSH subsystem. One caller holds
// the stream at a time. Remote strings and counts are bounded before allocating.
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};

pub(super) const MAX_PACKET: usize = 512 * 1024;
// SSH File Transfer Protocol v3 (draft-ietf-secsh-filexfer-02).
// Keep the request vocabulary restricted to read-only operations.
#[repr(u8)]
#[derive(Copy, Clone)]
pub(super) enum Request {
    Init = 1,
    Open = 3,
    Close = 4,
    Read = 5,
    Lstat = 7,
    Fstat = 8,
    OpenDir = 11,
    ReadDir = 12,
    Realpath = 16,
}
#[repr(u8)]
#[derive(Copy, Clone, PartialEq)]
pub(super) enum Reply {
    Version = 2,
    Status = 101,
    Handle = 102,
    Data = 103,
    Name = 104,
    Attrs = 105,
}
pub(super) type Result<T> = std::result::Result<T, Error>;
pub(super) enum Error {
    Transport(String), // The next frame cannot be trusted; discard the session.
    Request(String),   // The server rejected this operation; the session is usable.
    Eof,
}
impl Error {
    pub(super) fn message(&self) -> &str {
        match self {
            Self::Transport(s) | Self::Request(s) => s,
            Self::Eof => "The server reached the end of the file.",
        }
    }
}
fn invalid() -> Error {
    Error::Transport("Invalid SFTP response.".into())
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::Transport("The SSH connection closed.".into())
    }
}

pub(super) fn put_string(bytes: &mut Vec<u8>, value: &[u8]) {
    bytes.extend_from_slice(&(value.len() as u32).to_be_bytes());
    bytes.extend_from_slice(value);
}

pub(super) struct Fields<'a>(pub &'a [u8]);
impl<'a> Fields<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let (value, rest) = self.0.split_at_checked(count).ok_or_else(invalid)?;
        self.0 = rest;
        Ok(value)
    }
    pub fn number(&mut self) -> Result<u32> {
        Ok(u32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub fn string(&mut self) -> Result<&'a [u8]> {
        let size = self.number()? as usize;
        self.take(size)
    }
    pub fn attrs(&mut self) -> Result<Attrs> {
        let flags = self.number()?;
        if flags & !0x8000000f != 0 {
            return Err(invalid());
        }
        let size = if flags & 1 != 0 {
            Some(u64::from_be_bytes(self.take(8)?.try_into().unwrap()))
        } else {
            None
        };
        if flags & 2 != 0 {
            self.take(8)?;
        }
        let mode = if flags & 4 != 0 { self.number()? } else { 0 };
        let modified = if flags & 8 != 0 {
            self.number()?;
            Some(u64::from(self.number()?) * 1000)
        } else {
            None
        };
        if flags & 0x80000000 != 0 {
            let count = self.number()?;
            for _ in 0..count {
                self.string()?;
                self.string()?;
            }
        }
        Ok(Attrs {
            mode,
            size,
            modified,
        })
    }
}
pub(super) struct Attrs {
    pub mode: u32,
    pub size: Option<u64>,
    pub modified: Option<u64>,
}
impl Attrs {
    pub fn kind(&self) -> u32 {
        self.mode & 0o170000
    }
}

pub(super) struct Wire {
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    seq: u32,
    initialized: bool,
}
impl Wire {
    pub fn new(input: ChildStdin, output: ChildStdout) -> Self {
        Self {
            input,
            output: BufReader::new(output),
            seq: 0,
            initialized: false,
        }
    }
    async fn exchange(&mut self, kind: u8, number: u32, payload: &[u8]) -> Result<Vec<u8>> {
        let mut packet = Vec::with_capacity(9 + payload.len());
        packet.extend_from_slice(&((5 + payload.len()) as u32).to_be_bytes());
        packet.push(kind);
        packet.extend_from_slice(&number.to_be_bytes());
        packet.extend_from_slice(payload);
        self.input.write_all(&packet).await?;
        let size = self.output.read_u32().await? as usize;
        if !(5..=MAX_PACKET).contains(&size) {
            return Err(invalid());
        }
        let mut reply = vec![0; size];
        self.output.read_exact(&mut reply).await?;
        Ok(reply)
    }
    pub async fn init(&mut self) -> Result<()> {
        if !self.initialized {
            let response = self.exchange(Request::Init as u8, 3, &[]).await?;
            if response[..5] != [Reply::Version as u8, 0, 0, 0, 3] {
                return Err(Error::Transport(
                    "This server did not negotiate SFTP v3.".into(),
                ));
            }
            self.initialized = true;
        }
        Ok(())
    }
    pub async fn request(
        &mut self,
        kind: Request,
        payload: &[u8],
        expected: Reply,
    ) -> Result<Vec<u8>> {
        self.seq = self.seq.wrapping_add(1);
        let mut reply = self.exchange(kind as u8, self.seq, payload).await?;
        if reply[1..5] != self.seq.to_be_bytes() {
            return Err(invalid());
        }
        let ty = reply[0];
        if ty == Reply::Status as u8 {
            let mut fields = Fields(&reply[5..]);
            return match fields.number()? {
                0 if expected == Reply::Status => Ok(vec![]),
                1 => Err(Error::Eof),
                2 => Err(Error::Request("The remote path does not exist.".into())),
                3 => Err(Error::Request(
                    "Permission denied by the remote server.".into(),
                )),
                6 | 7 => Err(Error::Transport("The remote connection was lost.".into())),
                _ => Err(Error::Request(
                    "The SFTP server could not complete this request.".into(),
                )),
            };
        }
        if ty != expected as u8 {
            return Err(invalid());
        }
        reply.drain(..5);
        Ok(reply)
    }
    pub async fn path_request(
        &mut self,
        kind: Request,
        path: &[u8],
        expected: Reply,
    ) -> Result<Vec<u8>> {
        let mut payload = Vec::new();
        put_string(&mut payload, path);
        self.request(kind, &payload, expected).await
    }
    pub async fn close(&mut self, handle: &[u8]) -> Result<()> {
        self.path_request(Request::Close, handle, Reply::Status)
            .await?;
        Ok(())
    }
}
