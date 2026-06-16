//! Persisted meter target (host/port) so a downloaded app remembers which instrument
//! to talk to across launches. Both the desktop app and the headless server can point
//! at a JSON file; the headless server may also just use env vars and skip persistence.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedConfig {
    pub meter_host: String,
    pub meter_port: u16,
}

/// Load the persisted config, or None if the file is absent/unreadable/invalid.
pub fn load(path: &Path) -> Option<PersistedConfig> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Write the config (creating parent directories as needed).
pub fn save(path: &Path, cfg: &PersistedConfig) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let text = serde_json::to_string_pretty(cfg)?;
    std::fs::write(path, text)
}
