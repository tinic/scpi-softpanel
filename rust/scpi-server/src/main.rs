//! Headless SCPI SoftPanel server: drives the meter task and exposes the same
//! HTTP/WS contract the Node broker did, so the existing Vue frontend connects
//! unchanged. This binary is the always-on LAN deployment; the Tauri desktop app
//! reuses the same `scpi-core` and (optionally) this server.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use scpi_core::messages::ClientMessage;
use scpi_core::meter::Command;
use scpi_core::{spawn, MeterConfig, MeterHandle, ServerMessage};
use serde_json::json;
use tower_http::services::{ServeDir, ServeFile};

#[derive(Clone)]
struct AppState {
    handle: MeterHandle,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cfg = Config::from_env();
    let bind = SocketAddr::new(cfg.host.parse().expect("invalid HOST"), cfg.port);
    let web_dist = cfg.web_dist.clone();

    let handle = spawn(MeterConfig {
        host: cfg.meter_host.clone(),
        port: cfg.meter_port,
        resource: format!("TCPIP::{}::{}::SOCKET", cfg.meter_host, cfg.meter_port),
        timeout: Duration::from_millis(cfg.meter_timeout_ms),
        poll_interval_ms: cfg.poll_interval_ms,
        poll_autostart: cfg.poll_autostart,
        reconnect_delay: Duration::from_millis(3000),
        ring_capacity: cfg.ring_capacity,
    });

    let state = AppState { handle };
    let mut app = Router::new()
        .route("/api/health", get(health))
        .route("/api/state", get(api_state))
        .route("/api/readings", get(api_readings))
        .route("/ws", get(ws_upgrade))
        .with_state(state);

    if web_dist.is_dir() {
        let index = web_dist.join("index.html");
        // SPA fallback: unknown non-API paths serve index.html.
        app =
            app.fallback_service(ServeDir::new(&web_dist).not_found_service(ServeFile::new(index)));
        tracing::info!("serving web UI from {}", web_dist.display());
    } else {
        tracing::warn!(
            "web dist {} not found; API/WS only (use Vite in dev)",
            web_dist.display()
        );
    }

    let listener = tokio::net::TcpListener::bind(bind).await.expect("bind");
    tracing::info!(
        "scpi-server on http://{bind}  (meter {}:{})",
        cfg.meter_host,
        cfg.meter_port
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("serve");
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}

// -- REST -------------------------------------------------------------------

async fn health(State(app): State<AppState>) -> impl IntoResponse {
    let connected = app.handle.state_rx.borrow().connected;
    Json(json!({ "ok": true, "connected": connected }))
}

async fn api_state(State(app): State<AppState>) -> impl IntoResponse {
    Json(app.handle.state_rx.borrow().clone())
}

#[derive(serde::Deserialize)]
struct ReadingsQuery {
    n: Option<usize>,
}

async fn api_readings(
    State(app): State<AppState>,
    Query(q): Query<ReadingsQuery>,
) -> impl IntoResponse {
    let readings = app.handle.ring.lock().await.recent(q.n);
    Json(readings)
}

// -- WebSocket --------------------------------------------------------------

async fn ws_upgrade(State(app): State<AppState>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_session(socket, app))
}

async fn ws_session(socket: WebSocket, app: AppState) {
    use futures_util::StreamExt;
    let (mut sink, mut stream) = socket.split();

    // Initial snapshot: current state + reading history. Clone the state out of the
    // watch borrow *before* awaiting the ring lock so no non-Send guard is held.
    let state = app.handle.state_rx.borrow().clone();
    let readings = app.handle.ring.lock().await.recent(None);
    let snapshot = ServerMessage::Snapshot { state, readings };
    if send_json(&mut sink, &snapshot).await.is_err() {
        return;
    }

    // Forward live events to this client.
    let mut events = app.handle.events.subscribe();
    let mut send_task = tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(msg) => {
                    if send_json(&mut sink, &msg).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });

    // Receive client commands.
    let cmd = app.handle.cmd.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = stream.next().await {
            if let Message::Text(text) = msg {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(client_msg) => {
                        if cmd.send(to_command(client_msg)).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => tracing::debug!("bad client frame: {e}"),
                }
            }
        }
    });

    // When either side ends, tear down the other.
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}

async fn send_json<S>(sink: &mut S, msg: &ServerMessage) -> Result<(), ()>
where
    S: futures_util::Sink<Message> + Unpin,
{
    use futures_util::SinkExt;
    let text = serde_json::to_string(msg).map_err(|_| ())?;
    sink.send(Message::Text(text)).await.map_err(|_| ())
}

fn to_command(msg: ClientMessage) -> Command {
    match msg {
        ClientMessage::SetFunction { function } => Command::SetFunction(function),
        ClientMessage::SetRange { range } => Command::SetRange(range),
        ClientMessage::SetAutoRange { enabled } => Command::SetAutoRange(enabled),
        ClientMessage::SetNplc { nplc } => Command::SetNplc(nplc),
        ClientMessage::SetContThreshold { ohms } => Command::SetContThreshold(ohms),
        ClientMessage::SetPolling { enabled } => Command::SetPolling(enabled),
        ClientMessage::SetInterval { interval_ms } => Command::SetInterval(interval_ms),
        ClientMessage::MeasureOnce => Command::MeasureOnce,
        ClientMessage::Refresh => Command::Refresh,
        ClientMessage::Raw { cmd, expect_reply } => Command::Raw { cmd, expect_reply },
    }
}

// -- config -----------------------------------------------------------------

struct Config {
    host: String,
    port: u16,
    meter_host: String,
    meter_port: u16,
    meter_timeout_ms: u64,
    poll_interval_ms: u64,
    poll_autostart: bool,
    ring_capacity: usize,
    web_dist: PathBuf,
}

impl Config {
    fn from_env() -> Self {
        Config {
            host: env("HOST", "0.0.0.0"),
            port: env("PORT", "8080").parse().unwrap_or(8080),
            meter_host: env("METER_HOST", "192.168.1.166"),
            meter_port: env("METER_PORT", "5025").parse().unwrap_or(5025),
            meter_timeout_ms: env("METER_TIMEOUT_MS", "5000").parse().unwrap_or(5000),
            poll_interval_ms: env("POLL_INTERVAL_MS", "100").parse().unwrap_or(100),
            poll_autostart: matches!(
                env("POLL_AUTOSTART", "true").as_str(),
                "1" | "true" | "yes" | "on"
            ),
            ring_capacity: env("RING_CAPACITY", "3600").parse().unwrap_or(3600),
            web_dist: PathBuf::from(env("WEB_DIST", "../apps/web/dist")),
        }
    }
}

fn env(key: &str, fallback: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}
