//! Core logic for SCPI SoftPanel: instrument session, state machine, poll loop,
//! reading history, and the wire contract shared with the web frontend. Shared by
//! the headless server binary and (later) the Tauri desktop app.

pub mod csv_log;
pub mod functions;
pub mod messages;
pub mod meter;
pub mod ring;
pub mod scpi;

pub use functions::MeterFunction;
pub use messages::{ClientMessage, MeterState, Reading, ServerMessage};
pub use meter::{spawn, Command, MeterConfig, MeterHandle};
