//! Raw-socket SCPI transport. The SDM3045X exposes a newline-delimited SCPI socket
//! on TCP 5025: write `"<cmd>\n"`, and for a query read one `\n`-terminated line.
//! This sidesteps VXI-11/ONC-RPC entirely (plain TCP), which is both simpler and
//! gentler on the instrument than the old pyvisa bridge.

use std::io;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedReadHalf;
use tokio::net::TcpStream;
use tokio::time::timeout;

/// One open control session. The meter allows exactly one — hold a single instance.
pub struct ScpiSession {
    writer: tokio::net::tcp::OwnedWriteHalf,
    reader: BufReader<OwnedReadHalf>,
    timeout: Duration,
}

impl ScpiSession {
    /// Open a raw-socket session to `host:port` and return it once `*IDN?` answers.
    pub async fn connect(
        host: &str,
        port: u16,
        timeout_dur: Duration,
    ) -> io::Result<(Self, String)> {
        let stream = timeout(timeout_dur, TcpStream::connect((host, port)))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "connect timed out"))??;
        stream.set_nodelay(true).ok();
        let (rd, wr) = stream.into_split();
        let mut session = Self {
            writer: wr,
            reader: BufReader::new(rd),
            timeout: timeout_dur,
        };
        let idn = session.query("*IDN?").await?;
        Ok((session, idn))
    }

    /// Write a command with no reply expected.
    pub async fn write(&mut self, cmd: &str) -> io::Result<()> {
        let line = format!("{}\n", cmd.trim_end());
        timeout(self.timeout, self.writer.write_all(line.as_bytes()))
            .await
            .map_err(timed_out)??;
        Ok(())
    }

    /// Write a query and read one newline-terminated reply, trimmed.
    pub async fn query(&mut self, cmd: &str) -> io::Result<String> {
        self.write(cmd).await?;
        timeout(self.timeout, read_line(&mut self.reader))
            .await
            .map_err(timed_out)?
    }
}

/// Read until `\n` without pulling in tokio's line-codec; keeps the byte loop explicit
/// so a closed socket surfaces as EOF (an error) rather than an empty string.
async fn read_line(reader: &mut BufReader<OwnedReadHalf>) -> io::Result<String> {
    let mut buf = Vec::with_capacity(64);
    loop {
        let b = reader.read_u8().await?; // EOF -> UnexpectedEof error
        if b == b'\n' {
            break;
        }
        buf.push(b);
    }
    Ok(String::from_utf8_lossy(&buf).trim().to_string())
}

fn timed_out(_: tokio::time::error::Elapsed) -> io::Error {
    io::Error::new(io::ErrorKind::TimedOut, "scpi I/O timed out")
}
