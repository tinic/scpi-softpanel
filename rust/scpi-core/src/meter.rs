//! The instrument controller: a single async task that owns the one SCPI session,
//! holds the canonical [`MeterState`], runs the poll loop, and reconnects. Ported
//! from `apps/server/src/meter/Meter.ts` + `Poller.ts`, collapsed into one task now
//! that there is no separate Python bridge.
//!
//! Clients drive it by sending [`Command`]s; it publishes the latest state on a
//! `watch` channel (for REST/snapshot) and streams [`ServerMessage`]s on a
//! `broadcast` channel (for live WS push).

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{broadcast, mpsc, watch, Mutex};
use tokio::time::{sleep_until, Instant};

use crate::functions::{parse_function_response, parse_reading_value, MeterFunction};
use crate::messages::{ConsoleEntry, Direction, MeterState, Reading, ServerMessage};
use crate::ring::RingStore;
use crate::scpi::ScpiSession;

#[derive(Debug, Clone)]
pub enum Command {
    SetFunction(MeterFunction),
    SetRange(String),
    SetAutoRange(bool),
    SetNplc(f64),
    SetContThreshold(f64),
    SetPolling(bool),
    /// Open (true) or close (false) the instrument session.
    SetConnected(bool),
    SetInterval(u64),
    /// Point the meter at a different instrument (host/port) and reconnect.
    SetTarget {
        host: String,
        port: u16,
    },
    MeasureOnce,
    Refresh,
    Raw {
        cmd: String,
        expect_reply: bool,
    },
}

pub struct MeterConfig {
    pub host: String,
    pub port: u16,
    /// Human-facing resource string shown in state (e.g. `TCPIP::host::5025::SOCKET`).
    pub resource: String,
    pub timeout: Duration,
    pub poll_interval_ms: u64,
    pub poll_autostart: bool,
    pub reconnect_delay: Duration,
    pub ring_capacity: usize,
}

/// Cloneable handle the server layer uses to talk to the meter task.
#[derive(Clone)]
pub struct MeterHandle {
    pub cmd: mpsc::Sender<Command>,
    pub state_rx: watch::Receiver<MeterState>,
    pub events: broadcast::Sender<ServerMessage>,
    pub ring: Arc<Mutex<RingStore>>,
}

pub fn spawn(cfg: MeterConfig) -> MeterHandle {
    let (cmd_tx, cmd_rx) = mpsc::channel(64);
    let (events_tx, _events_rx) = broadcast::channel(512);
    let ring = Arc::new(Mutex::new(RingStore::new(cfg.ring_capacity)));

    let state = MeterState {
        connected: false,
        enabled: true, // start by trying to connect
        idn: None,
        resource: Some(cfg.resource.clone()),
        function: None,
        range: None,
        auto_range: None,
        nplc: None,
        cont_threshold: None,
        polling: cfg.poll_autostart,
        interval_ms: cfg.poll_interval_ms,
        last_error: None,
    };
    let (state_tx, state_rx) = watch::channel(state.clone());

    let meter = Meter {
        cfg,
        session: None,
        state,
        state_tx,
        events: events_tx.clone(),
        ring: ring.clone(),
        next_reconnect: Instant::now(),
        next_poll: Instant::now(),
    };
    tokio::spawn(meter.run(cmd_rx));

    MeterHandle {
        cmd: cmd_tx,
        state_rx,
        events: events_tx,
        ring,
    }
}

struct Meter {
    cfg: MeterConfig,
    session: Option<ScpiSession>,
    state: MeterState,
    state_tx: watch::Sender<MeterState>,
    events: broadcast::Sender<ServerMessage>,
    ring: Arc<Mutex<RingStore>>,
    // Reconnect/poll deadlines kept on the struct so command handlers (e.g. a
    // retarget) can reschedule them.
    next_reconnect: Instant,
    next_poll: Instant,
}

impl Meter {
    async fn run(mut self, mut cmd_rx: mpsc::Receiver<Command>) {
        loop {
            let idle = Instant::now() + Duration::from_secs(3600);
            let deadline = if !self.state.enabled {
                idle // user disconnected: don't reconnect or poll
            } else if self.session.is_none() {
                self.next_reconnect
            } else if self.state.polling {
                self.next_poll
            } else {
                idle
            };

            tokio::select! {
                maybe = cmd_rx.recv() => match maybe {
                    Some(cmd) => self.handle(cmd).await,
                    None => break, // every sender dropped → shut down
                },
                _ = sleep_until(deadline) => {
                    if !self.state.enabled {
                        // idle
                    } else if self.session.is_none() {
                        self.try_connect().await;
                        self.next_reconnect = Instant::now() + self.cfg.reconnect_delay;
                        self.next_poll = Instant::now();
                    } else if self.state.polling {
                        self.poll_once().await;
                        self.next_poll = Instant::now()
                            + Duration::from_millis(self.state.interval_ms.max(10));
                    }
                }
            }
        }
    }

    // -- connection ----------------------------------------------------------

    async fn try_connect(&mut self) {
        // Raw-socket connect is itself a gentle TCP probe — unlike VXI-11/RPC it
        // won't wedge a booting meter, so no separate probe/boot-settle is needed.
        self.console(
            Direction::Info,
            &format!("connecting {}", self.cfg.resource),
        );
        match ScpiSession::connect(&self.cfg.host, self.cfg.port, self.cfg.timeout).await {
            Ok((session, idn)) => {
                self.session = Some(session);
                // Clear any stale status/error queue so we start from a clean slate.
                let _ = self.session.as_mut().unwrap().write("*CLS").await;
                self.state.connected = true;
                self.state.idn = Some(idn.clone());
                self.state.last_error = None;
                self.publish();
                self.console(Direction::Info, &format!("connected: {idn}"));
                self.refresh_config().await;
            }
            Err(e) => {
                self.state.connected = false;
                self.state.last_error = Some(e.to_string());
                self.publish();
            }
        }
    }

    /// Drop a dead session so the reconnect loop takes over.
    fn drop_session(&mut self, context: &str, e: &std::io::Error) {
        self.session = None;
        self.state.connected = false;
        self.state.last_error = Some(e.to_string());
        self.publish();
        self.console(Direction::Error, &format!("{context}: {e}"));
    }

    async fn poll_once(&mut self) {
        match self.measure().await {
            Ok(reading) => {
                self.ring.lock().await.push(reading.clone());
                let _ = self.events.send(ServerMessage::Reading { reading });
            }
            Err(e) => self.drop_session("poll", &e),
        }
    }

    // -- command dispatch ----------------------------------------------------

    async fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::SetPolling(on) => {
                self.state.polling = on;
                self.publish();
                return;
            }
            Command::SetInterval(ms) => {
                self.state.interval_ms = ms.clamp(10, 60_000);
                self.publish();
                return;
            }
            Command::SetConnected(on) => {
                if on {
                    self.state.enabled = true;
                    self.next_reconnect = Instant::now(); // reconnect promptly
                    self.console(Direction::Info, "connecting");
                } else {
                    self.state.enabled = false;
                    // Drop the session → the TCP socket closes, releasing the control
                    // link. The SDM3045X has no SCPI local/remote command (SYST:LOC /
                    // REM / RWL all return -113), so the user presses the meter's
                    // Run/Stop key to return it to local control (user manual §p89).
                    self.session = None;
                    self.state.connected = false;
                    self.state.idn = None;
                    self.console(
                        Direction::Info,
                        "disconnected — press Run/Stop on the meter for local control",
                    );
                }
                self.publish();
                return;
            }
            Command::SetTarget { host, port } => {
                // Drop the current session and reconnect to the new instrument now.
                self.session = None;
                self.state.connected = false;
                self.state.idn = None;
                self.cfg.host = host;
                self.cfg.port = port;
                self.cfg.resource = format!("TCPIP::{}::{}::SOCKET", self.cfg.host, self.cfg.port);
                self.state.resource = Some(self.cfg.resource.clone());
                self.next_reconnect = Instant::now();
                self.console(
                    Direction::Info,
                    &format!("retargeting to {}", self.cfg.resource),
                );
                self.publish();
                return;
            }
            _ => {}
        }

        if self.session.is_none() {
            self.console(Direction::Error, "not connected");
            return;
        }

        let result = match cmd {
            Command::SetFunction(f) => self.set_function(f).await,
            Command::SetRange(r) => self.set_range(&r).await,
            Command::SetAutoRange(on) => self.set_auto_range(on).await,
            Command::SetNplc(n) => self.set_nplc(n).await,
            Command::SetContThreshold(o) => self.set_cont_threshold(o).await,
            Command::MeasureOnce => self.measure_once().await,
            Command::Refresh => self.refresh_config_checked().await,
            Command::Raw { cmd, expect_reply } => self.raw(&cmd, expect_reply).await,
            // Handled in the early match above (they return before reaching here).
            Command::SetPolling(_)
            | Command::SetInterval(_)
            | Command::SetConnected(_)
            | Command::SetTarget { .. } => Ok(()),
        };
        if let Err(e) = result {
            self.drop_session("command", &e);
        }
    }

    // -- control operations (mirror Meter.ts) --------------------------------

    async fn set_function(&mut self, f: MeterFunction) -> std::io::Result<()> {
        self.command(f.info().conf).await?;
        self.state.function = Some(f);
        self.publish();
        self.refresh_config().await;
        Ok(())
    }

    async fn set_nplc(&mut self, nplc: f64) -> std::io::Result<()> {
        let Some(sense) = self.current_sense_for(|i| i.supports_nplc) else {
            self.console(Direction::Error, "NPLC not applicable for this function");
            return Ok(());
        };
        self.command(&format!("SENS:{sense}:NPLC {nplc}")).await?;
        // Read back: the instrument clamps out-of-range values (100 -> 10).
        self.state.nplc = self
            .query_num(&format!("SENS:{sense}:NPLC?"))
            .await?
            .or(Some(nplc));
        self.publish();
        Ok(())
    }

    async fn set_range(&mut self, range: &str) -> std::io::Result<()> {
        let Some(sense) = self.current_sense_for(|i| i.supports_range) else {
            self.console(Direction::Error, "range not settable for this function");
            return Ok(());
        };
        if range.eq_ignore_ascii_case("AUTO") {
            self.command(&format!("SENS:{sense}:RANG:AUTO ON")).await?;
            self.state.auto_range = Some(true);
            self.state.range = Some("AUTO".into());
        } else {
            self.command(&format!("SENS:{sense}:RANG {range}")).await?;
            let actual = self.query_num(&format!("SENS:{sense}:RANG?")).await?;
            self.state.auto_range = Some(false);
            self.state.range = Some(actual.map(fmt_num).unwrap_or_else(|| range.to_string()));
        }
        self.publish();
        Ok(())
    }

    async fn set_auto_range(&mut self, enabled: bool) -> std::io::Result<()> {
        let Some(sense) = self.current_sense_for(|i| i.supports_range) else {
            self.console(Direction::Error, "autorange not settable for this function");
            return Ok(());
        };
        self.command(&format!(
            "SENS:{sense}:RANG:AUTO {}",
            if enabled { "ON" } else { "OFF" }
        ))
        .await?;
        self.state.auto_range = Some(enabled);
        if enabled {
            self.state.range = Some("AUTO".into());
        } else {
            let r = self.query_num(&format!("SENS:{sense}:RANG?")).await?;
            self.state.range = r.map(fmt_num);
        }
        self.publish();
        Ok(())
    }

    async fn set_cont_threshold(&mut self, ohms: f64) -> std::io::Result<()> {
        if self.state.function != Some(MeterFunction::Cont) {
            self.console(
                Direction::Error,
                "continuity threshold is only settable in CONT mode",
            );
            return Ok(());
        }
        self.command(&format!("CONT:THR:VAL {ohms}")).await?;
        self.state.cont_threshold = self.query_num("CONT:THR:VAL?").await?.or(Some(ohms));
        self.publish();
        Ok(())
    }

    async fn measure_once(&mut self) -> std::io::Result<()> {
        let reading = self.measure().await?;
        self.ring.lock().await.push(reading.clone());
        let _ = self.events.send(ServerMessage::Reading { reading });
        Ok(())
    }

    async fn raw(&mut self, cmd: &str, expect_reply: bool) -> std::io::Result<()> {
        self.console(Direction::Tx, cmd);
        if expect_reply {
            let reply = self.session.as_mut().unwrap().query(cmd).await?;
            self.console(Direction::Rx, &reply);
        } else {
            self.session.as_mut().unwrap().write(cmd).await?;
            // A bare write may have changed function/range/NPLC; re-read.
            self.refresh_config().await;
        }
        Ok(())
    }

    async fn refresh_config_checked(&mut self) -> std::io::Result<()> {
        self.refresh_config().await;
        Ok(())
    }

    // -- measurement & read-back ---------------------------------------------

    async fn measure(&mut self) -> std::io::Result<Reading> {
        let raw = self.session.as_mut().unwrap().query("READ?").await?;
        let (value, overload) = parse_reading_value(&raw);
        let func = self.state.function;
        Ok(Reading {
            ts: now_ms(),
            value,
            unit: func.map(|f| f.unit().to_string()).unwrap_or_default(),
            function: func
                .map(|f| {
                    serde_json::to_value(f)
                        .unwrap()
                        .as_str()
                        .unwrap()
                        .to_string()
                })
                .unwrap_or_else(|| "UNKNOWN".into()),
            overload,
            raw: Some(raw),
        })
    }

    /// Best-effort re-read of function/range/autorange/NPLC/threshold. Errors here
    /// are logged, not fatal (a transient glitch shouldn't drop the session).
    async fn refresh_config(&mut self) {
        let func = match self.session.as_mut().unwrap().query("FUNC?").await {
            Ok(raw) => parse_function_response(&raw),
            Err(e) => {
                self.console(Direction::Error, &format!("config read-back failed: {e}"));
                return;
            }
        };
        self.state.function = func;
        if let Some(f) = func {
            let info = f.info();
            if let Some(sense) = info.sense.filter(|_| info.supports_range) {
                self.state.auto_range = self.query_bool(&format!("SENS:{sense}:RANG:AUTO?")).await;
                let r = self
                    .query_num(&format!("SENS:{sense}:RANG?"))
                    .await
                    .ok()
                    .flatten();
                self.state.range = if self.state.auto_range == Some(true) {
                    Some("AUTO".into())
                } else {
                    r.map(fmt_num)
                };
            } else {
                self.state.auto_range = None;
                self.state.range = None;
            }
            self.state.nplc = match info.sense.filter(|_| info.supports_nplc) {
                Some(sense) => self
                    .query_num(&format!("SENS:{sense}:NPLC?"))
                    .await
                    .ok()
                    .flatten(),
                None => None,
            };
            // Meter resets this to its 50 Ω default on every CONFigure.
            self.state.cont_threshold = if f == MeterFunction::Cont {
                self.query_num("CONT:THR:VAL?").await.ok().flatten()
            } else {
                None
            };
        }
        self.publish();
    }

    // -- low-level helpers ---------------------------------------------------

    async fn command(&mut self, cmd: &str) -> std::io::Result<()> {
        self.console(Direction::Tx, cmd);
        self.session.as_mut().unwrap().write(cmd).await
    }

    async fn query_num(&mut self, cmd: &str) -> std::io::Result<Option<f64>> {
        let reply = self.session.as_mut().unwrap().query(cmd).await?;
        Ok(reply.trim().parse::<f64>().ok().filter(|n| n.is_finite()))
    }

    async fn query_bool(&mut self, cmd: &str) -> Option<bool> {
        let reply = self.session.as_mut().unwrap().query(cmd).await.ok()?;
        let t = reply.trim().to_uppercase();
        Some(t == "1" || t == "ON")
    }

    fn current_sense_for(
        &self,
        pred: impl Fn(&crate::functions::FunctionInfo) -> bool,
    ) -> Option<&'static str> {
        let info = self.state.function?.info();
        info.sense.filter(|_| pred(&info))
    }

    fn publish(&self) {
        let _ = self.state_tx.send(self.state.clone());
        let _ = self.events.send(ServerMessage::State {
            state: self.state.clone(),
        });
    }

    fn console(&self, direction: Direction, text: &str) {
        let _ = self.events.send(ServerMessage::Console {
            entry: ConsoleEntry {
                ts: now_ms(),
                direction,
                text: text.to_string(),
            },
        });
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Match the TS `String(number)` round-trip used for range read-backs.
fn fmt_num(n: f64) -> String {
    let mut s = format!("{n}");
    if s.ends_with(".0") {
        s.truncate(s.len() - 2);
    }
    s
}
