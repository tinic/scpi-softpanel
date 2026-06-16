// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! SCPI SoftPanel desktop app. Reuses `scpi-core` (meter + state) and the
//! `scpi-server` HTTP/WS router, runs them on an embedded localhost server, and
//! points a Tauri webview at it. The Vue UI is embedded in the binary, so the app
//! is a single self-contained executable and the frontend is byte-identical to the
//! LAN-server build (same origin → no CORS/CSP special-casing).

use std::time::Duration;

use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;
use scpi_core::{spawn, MeterConfig};

/// The production Vue bundle, embedded at compile time.
#[derive(RustEmbed)]
#[folder = "../../apps/web/dist"]
struct WebAssets;

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    // Start the meter + HTTP/WS server on its own runtime thread; report the bound port.
    let (port_tx, port_rx) = std::sync::mpsc::channel::<u16>();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        rt.block_on(async move {
            let config_path = config_path();
            let handle = spawn(meter_config(config_path.as_deref()));
            let app = scpi_server::api_router(handle, config_path).fallback(serve_embedded);
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                .await
                .expect("bind localhost");
            let port = listener.local_addr().expect("local addr").port();
            let _ = port_tx.send(port);
            axum::serve(listener, app).await.expect("serve");
        });
    });

    let port = port_rx.recv().expect("server failed to start");
    let url = format!("http://127.0.0.1:{port}/");
    tracing::info!("backend ready at {url}");

    tauri::Builder::default()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url.parse().expect("valid url")),
            )
            .title("SCPI SoftPanel")
            .inner_size(1280.0, 820.0)
            .min_inner_size(900.0, 600.0)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Path to the persisted settings file in the OS config dir, e.g.
/// `~/.config/com.tinic.scpisoftpanel/config.json` on Linux.
fn config_path() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|d| d.join("com.tinic.scpisoftpanel").join("config.json"))
}

/// Meter config: persisted target if present, else env, else defaults.
fn meter_config(config_path: Option<&std::path::Path>) -> MeterConfig {
    let (host, port) = match config_path.and_then(scpi_server::config::load) {
        Some(p) => (p.meter_host, p.meter_port),
        // First launch: no persisted target and no baked-in IP — start with no host
        // so the UI prompts for one (env can still pre-seed it for power users).
        None => {
            let host = env("METER_HOST", "");
            let port = env("METER_PORT", "5025").parse().unwrap_or(5025);
            (host, port)
        }
    };
    MeterConfig {
        host,
        port,
        timeout: Duration::from_millis(env("METER_TIMEOUT_MS", "5000").parse().unwrap_or(5000)),
        poll_interval_ms: env("POLL_INTERVAL_MS", "100").parse().unwrap_or(100),
        poll_autostart: matches!(
            env("POLL_AUTOSTART", "true").as_str(),
            "1" | "true" | "yes" | "on"
        ),
        reconnect_delay: Duration::from_millis(3000),
        ring_capacity: env("RING_CAPACITY", "3600").parse().unwrap_or(3600),
    }
}

/// Serve the embedded Vue bundle, with SPA fallback to index.html.
async fn serve_embedded(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(content) = WebAssets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return (
            [(header::CONTENT_TYPE, mime.as_ref())],
            content.data.into_owned(),
        )
            .into_response();
    }
    // Unknown path → SPA fallback.
    match WebAssets::get("index.html") {
        Some(content) => (
            [(header::CONTENT_TYPE, "text/html")],
            content.data.into_owned(),
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

fn env(key: &str, fallback: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}
