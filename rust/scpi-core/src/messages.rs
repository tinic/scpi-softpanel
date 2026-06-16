//! Wire contract shared with the web frontend. Field names and tagged-union shapes
//! mirror `packages/shared/src/messages.ts` exactly so the existing Vue client speaks
//! to this server unchanged. JSON is camelCase.

use serde::{Deserialize, Serialize};

use crate::functions::MeterFunction;

/// A single measurement sample.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub ts: i64,
    /// Parsed value; non-finite (overload) serializes as null per JSON.
    #[serde(serialize_with = "ser_f64_nullable")]
    pub value: f64,
    pub unit: String,
    pub function: String,
    #[serde(default)]
    pub overload: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

/// Full instrument + broker state, broadcast on change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeterState {
    pub connected: bool,
    /// Whether the broker wants a session at all. False = user disconnected; the
    /// socket is closed and the instrument is free for front-panel use.
    pub enabled: bool,
    pub idn: Option<String>,
    pub resource: Option<String>,
    pub function: Option<MeterFunction>,
    /// Numeric string, or "AUTO".
    pub range: Option<String>,
    pub auto_range: Option<bool>,
    pub nplc: Option<f64>,
    /// CONT only; reset to 50 Ω by the meter on every CONFigure.
    pub cont_threshold: Option<f64>,
    /// Relative/Null: whether the offset is active, and its value (per function).
    pub null_enabled: bool,
    pub null_value: Option<f64>,
    /// AC functions only: low-frequency AC filter in Hz (3 / 20 / 200).
    pub ac_bandwidth: Option<f64>,
    /// FREQ/PER only: gate time (aperture) in seconds (0.01 / 0.1 / 1).
    pub freq_aperture: Option<f64>,
    pub polling: bool,
    pub interval_ms: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Tx,
    Rx,
    Info,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleEntry {
    pub ts: i64,
    pub direction: Direction,
    pub text: String,
}

/// Server -> client frames.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage {
    Snapshot {
        state: MeterState,
        readings: Vec<Reading>,
    },
    State {
        state: MeterState,
    },
    Reading {
        reading: Reading,
    },
    Console {
        entry: ConsoleEntry,
    },
    Error {
        message: String,
    },
}

/// Client -> server frames.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientMessage {
    SetFunction {
        function: MeterFunction,
    },
    SetRange {
        range: String,
    },
    SetAutoRange {
        enabled: bool,
    },
    SetNplc {
        nplc: f64,
    },
    SetContThreshold {
        ohms: f64,
    },
    SetNull {
        enabled: bool,
        value: f64,
    },
    SetAcBandwidth {
        hz: f64,
    },
    SetFreqAperture {
        seconds: f64,
    },
    SetPolling {
        enabled: bool,
    },
    /// Open (true) or close (false) the instrument session.
    SetConnected {
        enabled: bool,
    },
    #[serde(rename_all = "camelCase")]
    SetInterval {
        interval_ms: u64,
    },
    MeasureOnce,
    Refresh,
    #[serde(rename_all = "camelCase")]
    Raw {
        cmd: String,
        expect_reply: bool,
    },
}

/// Non-finite floats are not valid JSON; emit null (the frontend treats null as OL).
fn ser_f64_nullable<S: serde::Serializer>(v: &f64, s: S) -> Result<S::Ok, S::Error> {
    if v.is_finite() {
        s.serialize_f64(*v)
    } else {
        s.serialize_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_message_tag_shapes_match_ts() {
        let m: ClientMessage =
            serde_json::from_str(r#"{"type":"setInterval","intervalMs":250}"#).unwrap();
        assert!(matches!(m, ClientMessage::SetInterval { interval_ms: 250 }));
        let m: ClientMessage =
            serde_json::from_str(r#"{"type":"raw","cmd":"*IDN?","expectReply":true}"#).unwrap();
        assert!(matches!(
            m,
            ClientMessage::Raw {
                expect_reply: true,
                ..
            }
        ));
        let m: ClientMessage =
            serde_json::from_str(r#"{"type":"setFunction","function":"VOLT:DC"}"#).unwrap();
        assert!(matches!(
            m,
            ClientMessage::SetFunction {
                function: MeterFunction::VoltDc
            }
        ));
    }

    #[test]
    fn reading_overload_serializes_null() {
        let r = Reading {
            ts: 1,
            value: f64::INFINITY,
            unit: "V".into(),
            function: "VOLT:DC".into(),
            overload: true,
            raw: None,
        };
        let j = serde_json::to_value(&r).unwrap();
        assert!(j["value"].is_null());
    }

    #[test]
    fn server_message_is_internally_tagged() {
        let m = ServerMessage::Error {
            message: "x".into(),
        };
        assert_eq!(serde_json::to_value(&m).unwrap()["type"], "error");
    }
}
