//! Static metadata about the SDM3045X measurement functions plus the SCPI strings
//! needed to drive each one. Port of `packages/shared/src/functions.ts` — the single
//! source of truth the TS frontend uses. Ranges/NPLC were probed from a real meter.

use serde::{Deserialize, Serialize};

/// Canonical measurement function. The serde rename is the on-the-wire id the
/// frontend and SCPI layer share (e.g. `"VOLT:DC"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MeterFunction {
    #[serde(rename = "VOLT:DC")]
    VoltDc,
    #[serde(rename = "VOLT:AC")]
    VoltAc,
    #[serde(rename = "CURR:DC")]
    CurrDc,
    #[serde(rename = "CURR:AC")]
    CurrAc,
    #[serde(rename = "RES")]
    Res,
    #[serde(rename = "FRES")]
    Fres,
    #[serde(rename = "CAP")]
    Cap,
    #[serde(rename = "FREQ")]
    Freq,
    #[serde(rename = "PER")]
    Per,
    #[serde(rename = "CONT")]
    Cont,
    #[serde(rename = "DIOD")]
    Diod,
    #[serde(rename = "TEMP")]
    Temp,
}

/// Order shown in the UI keypad; mirrors `METER_FUNCTIONS`.
pub const METER_FUNCTIONS: [MeterFunction; 12] = [
    MeterFunction::VoltDc,
    MeterFunction::VoltAc,
    MeterFunction::CurrDc,
    MeterFunction::CurrAc,
    MeterFunction::Res,
    MeterFunction::Fres,
    MeterFunction::Cap,
    MeterFunction::Freq,
    MeterFunction::Per,
    MeterFunction::Cont,
    MeterFunction::Diod,
    MeterFunction::Temp,
];

/// Integration times the SDM3045X actually accepts; anything else is clamped
/// (e.g. NPLC 100 reads back as 10), verified against the instrument.
pub const NPLC_CHOICES: [f64; 3] = [0.3, 1.0, 10.0];

/// SDM overload / open-input sentinel is ~9.9E37; anything past this is "OL".
pub const OVERLOAD_THRESHOLD: f64 = 9e37;

pub struct FunctionInfo {
    pub label: &'static str,
    pub short: &'static str,
    pub unit: &'static str,
    /// `CONFigure` command that selects this function.
    pub conf: &'static str,
    /// `SENSe` subsystem prefix for RANGe/NPLC, or None when not applicable.
    pub sense: Option<&'static str>,
    pub supports_nplc: bool,
    pub supports_range: bool,
    /// Selectable manual ranges in base units, ascending, or None when fixed/automatic.
    pub ranges: Option<&'static [f64]>,
}

impl MeterFunction {
    pub fn info(self) -> FunctionInfo {
        use MeterFunction::*;
        match self {
            VoltDc => FunctionInfo {
                label: "DC Voltage",
                short: "V ⎓",
                unit: "V",
                conf: "CONF:VOLT:DC",
                sense: Some("VOLT:DC"),
                supports_nplc: true,
                supports_range: true,
                ranges: Some(&[0.2, 2.0, 20.0, 200.0, 1000.0]),
            },
            VoltAc => FunctionInfo {
                label: "AC Voltage",
                short: "V ∿",
                unit: "V",
                conf: "CONF:VOLT:AC",
                sense: Some("VOLT:AC"),
                supports_nplc: false,
                supports_range: true,
                ranges: Some(&[0.2, 2.0, 20.0, 200.0, 750.0]),
            },
            CurrDc => FunctionInfo {
                label: "DC Current",
                short: "A ⎓",
                unit: "A",
                conf: "CONF:CURR:DC",
                sense: Some("CURR:DC"),
                supports_nplc: true,
                supports_range: true,
                ranges: Some(&[0.0002, 0.002, 0.02, 0.2, 2.0, 10.0]),
            },
            CurrAc => FunctionInfo {
                label: "AC Current",
                short: "A ∿",
                unit: "A",
                conf: "CONF:CURR:AC",
                sense: Some("CURR:AC"),
                supports_nplc: false,
                supports_range: true,
                ranges: Some(&[0.02, 0.2, 2.0, 10.0]),
            },
            Res => FunctionInfo {
                label: "Resistance (2W)",
                short: "Ω 2W",
                unit: "Ω",
                conf: "CONF:RES",
                sense: Some("RES"),
                supports_nplc: true,
                supports_range: true,
                ranges: Some(&[200.0, 2e3, 20e3, 200e3, 2e6, 10e6, 100e6]),
            },
            Fres => FunctionInfo {
                label: "Resistance (4W)",
                short: "Ω 4W",
                unit: "Ω",
                conf: "CONF:FRES",
                sense: Some("FRES"),
                supports_nplc: true,
                supports_range: true,
                ranges: Some(&[200.0, 2e3, 20e3, 200e3, 2e6, 10e6, 100e6]),
            },
            Cap => FunctionInfo {
                label: "Capacitance",
                short: "⊣⊢",
                unit: "F",
                conf: "CONF:CAP",
                sense: Some("CAP"),
                supports_nplc: false,
                supports_range: true,
                ranges: Some(&[2e-9, 20e-9, 200e-9, 2e-6, 20e-6, 200e-6, 10e-3]),
            },
            Freq => FunctionInfo {
                label: "Frequency",
                short: "Hz",
                unit: "Hz",
                conf: "CONF:FREQ",
                sense: Some("FREQ"),
                supports_nplc: false,
                supports_range: false,
                ranges: None,
            },
            Per => FunctionInfo {
                label: "Period",
                short: "1/f",
                unit: "s",
                conf: "CONF:PER",
                sense: Some("PER"),
                supports_nplc: false,
                supports_range: false,
                ranges: None,
            },
            Cont => FunctionInfo {
                label: "Continuity",
                short: "◗))",
                unit: "Ω",
                conf: "CONF:CONT",
                sense: None,
                supports_nplc: false,
                supports_range: false,
                ranges: None,
            },
            Diod => FunctionInfo {
                label: "Diode",
                short: "─▶|─",
                unit: "V",
                conf: "CONF:DIOD",
                sense: None,
                supports_nplc: false,
                supports_range: false,
                ranges: None,
            },
            Temp => FunctionInfo {
                // The SDM3045X rejects SENS:TEMP:NPLC? (-113 Undefined header).
                label: "Temperature",
                short: "°C",
                unit: "°C",
                conf: "CONF:TEMP",
                sense: Some("TEMP"),
                supports_nplc: false,
                supports_range: false,
                ranges: None,
            },
        }
    }

    pub fn unit(self) -> &'static str {
        self.info().unit
    }
}

/// Normalize the instrument's `FUNCtion?` reply (`"VOLT"`, `"VOLT:DC"`, `"FRES"`, …)
/// into a canonical [`MeterFunction`]. Returns None when unrecognized.
pub fn parse_function_response(raw: &str) -> Option<MeterFunction> {
    use MeterFunction::*;
    match raw.replace('"', "").trim().to_uppercase().as_str() {
        "VOLT" | "VOLT:DC" => Some(VoltDc),
        "VOLT:AC" => Some(VoltAc),
        "CURR" | "CURR:DC" => Some(CurrDc),
        "CURR:AC" => Some(CurrAc),
        "RES" => Some(Res),
        "FRES" => Some(Fres),
        "CAP" => Some(Cap),
        "FREQ" => Some(Freq),
        "PER" => Some(Per),
        "CONT" => Some(Cont),
        "DIOD" => Some(Diod),
        "TEMP" => Some(Temp),
        _ => None,
    }
}

/// Parse a raw SCPI numeric reply into (value, overload). The SDM returns
/// scientific notation, e.g. `+1.89975329E-03`, and `±9.9E37` for overload.
pub fn parse_reading_value(raw: &str) -> (f64, bool) {
    match raw.trim().parse::<f64>() {
        Ok(v) if v.abs() <= OVERLOAD_THRESHOLD => (v, false),
        Ok(v) => (
            if v < 0.0 {
                f64::NEG_INFINITY
            } else {
                f64::INFINITY
            },
            true,
        ),
        Err(_) => (f64::INFINITY, true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_bare_volt_to_dc() {
        assert_eq!(
            parse_function_response("\"VOLT\""),
            Some(MeterFunction::VoltDc)
        );
        assert_eq!(parse_function_response("FRES"), Some(MeterFunction::Fres));
        assert_eq!(parse_function_response("BOGUS"), None);
    }

    #[test]
    fn parses_and_flags_overload() {
        let (v, ol) = parse_reading_value("+1.89975329E-03");
        assert!((v - 0.00189975329).abs() < 1e-12 && !ol);
        let (v, ol) = parse_reading_value("+9.90000000E+37");
        assert!(v.is_infinite() && ol);
    }

    #[test]
    fn ranges_present_iff_settable() {
        for f in METER_FUNCTIONS {
            let i = f.info();
            assert_eq!(i.supports_range, i.ranges.is_some());
        }
    }

    #[test]
    fn function_wire_ids_roundtrip() {
        let j = serde_json::to_string(&MeterFunction::VoltDc).unwrap();
        assert_eq!(j, "\"VOLT:DC\"");
    }
}
