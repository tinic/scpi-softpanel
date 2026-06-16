//! Headless SCPI SoftPanel server: drives the meter task and exposes the same
//! HTTP/WS contract the Node broker did, so the existing Vue frontend connects
//! unchanged. This binary is the always-on LAN deployment; the Tauri desktop app
//! reuses `scpi-core` + this crate's `api_router`.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use scpi_core::{spawn, MeterConfig};
use scpi_server::api_router;
use tower_http::services::{ServeDir, ServeFile};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cfg = Config::from_env();
    let bind = SocketAddr::new(cfg.host.parse().expect("invalid HOST"), cfg.port);

    // A persisted target (if CONFIG_PATH is set and the file exists) overrides env.
    let (meter_host, meter_port) = match cfg
        .config_path
        .as_deref()
        .and_then(scpi_server::config::load)
    {
        Some(p) => (p.meter_host, p.meter_port),
        None => (cfg.meter_host.clone(), cfg.meter_port),
    };

    let handle = spawn(MeterConfig {
        host: meter_host,
        port: meter_port,
        timeout: Duration::from_millis(cfg.meter_timeout_ms),
        poll_interval_ms: cfg.poll_interval_ms,
        poll_autostart: cfg.poll_autostart,
        reconnect_delay: Duration::from_millis(3000),
        ring_capacity: cfg.ring_capacity,
    });

    let mut app = api_router(handle, cfg.config_path.clone());
    if cfg.web_dist.is_dir() {
        let index = cfg.web_dist.join("index.html");
        app = app.fallback_service(
            ServeDir::new(&cfg.web_dist).not_found_service(ServeFile::new(index)),
        );
        tracing::info!("serving web UI from {}", cfg.web_dist.display());
    } else {
        tracing::warn!(
            "web dist {} not found; API/WS only (use Vite in dev)",
            cfg.web_dist.display()
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
    /// Optional persisted-settings file (env `CONFIG_PATH`).
    config_path: Option<PathBuf>,
}

impl Config {
    fn from_env() -> Self {
        let config_path = std::env::var("CONFIG_PATH")
            .ok()
            .filter(|v| !v.is_empty())
            .map(PathBuf::from);
        Config {
            host: env("HOST", "0.0.0.0"),
            port: env("PORT", "8080").parse().unwrap_or(8080),
            // No baked-in default IP: empty host => no target until configured.
            meter_host: env("METER_HOST", ""),
            meter_port: env("METER_PORT", "5025").parse().unwrap_or(5025),
            meter_timeout_ms: env("METER_TIMEOUT_MS", "5000").parse().unwrap_or(5000),
            poll_interval_ms: env("POLL_INTERVAL_MS", "100").parse().unwrap_or(100),
            poll_autostart: matches!(
                env("POLL_AUTOSTART", "true").as_str(),
                "1" | "true" | "yes" | "on"
            ),
            ring_capacity: env("RING_CAPACITY", "3600").parse().unwrap_or(3600),
            web_dist: PathBuf::from(env("WEB_DIST", "../apps/web/dist")),
            config_path,
        }
    }
}

fn env(key: &str, fallback: &str) -> String {
    std::env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}
