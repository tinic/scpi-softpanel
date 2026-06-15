//! Reusable HTTP/WS layer over a [`MeterHandle`]. Both the headless `scpi-server`
//! binary and the Tauri desktop app build on [`api_router`], adding their own static
//! file serving (disk vs. embedded) as a fallback.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use scpi_core::messages::ClientMessage;
use scpi_core::meter::Command;
use scpi_core::{MeterHandle, ServerMessage};
use serde_json::json;

#[derive(Clone)]
pub struct AppState {
    pub handle: MeterHandle,
}

/// Router exposing `/api/health`, `/api/state`, `/api/readings`, and `/ws`. The caller
/// supplies static-asset serving via `.fallback_service(...)`.
pub fn api_router(handle: MeterHandle) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/state", get(api_state))
        .route("/api/readings", get(api_readings))
        .route("/ws", get(ws_upgrade))
        .with_state(AppState { handle })
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
    Json(app.handle.ring.lock().await.recent(q.n))
}

// -- WebSocket --------------------------------------------------------------

async fn ws_upgrade(State(app): State<AppState>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_session(socket, app))
}

async fn ws_session(socket: WebSocket, app: AppState) {
    use futures_util::StreamExt;
    let (mut sink, mut stream) = socket.split();

    // Initial snapshot: clone state out of the watch borrow *before* awaiting the ring
    // lock so no non-Send guard is held across the await.
    let state = app.handle.state_rx.borrow().clone();
    let readings = app.handle.ring.lock().await.recent(None);
    if send_json(&mut sink, &ServerMessage::Snapshot { state, readings })
        .await
        .is_err()
    {
        return;
    }

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
