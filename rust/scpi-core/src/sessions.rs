//! Named recording sessions persisted to disk — long-run logging that outlives the
//! in-memory ring and CSV buffer (and the app restarting).
//!
//! Each session is two files in the sessions directory:
//!   `<id>.csv`   the readings, same columns as the live CSV export
//!   `<id>.json`  [`SessionMeta`]: name, start/end, count, markers
//!
//! Only one session records at a time (there is one meter). The [`Recorder`] lives in
//! the meter task and is fed every reading; listing/reading/deleting finished
//! sessions are plain filesystem functions the HTTP layer calls directly.

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::csv_log::CSV_HEADER;

/// A note pinned to a moment in time ("swapped R3", "heater on").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Marker {
    pub ts: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub name: String,
    /// Epoch ms.
    pub started: i64,
    /// Epoch ms; None while recording (or if the app died mid-session).
    pub ended: Option<i64>,
    /// Planned length; the recorder stops itself once it's reached. None = until stopped.
    pub duration_ms: Option<u64>,
    pub count: u64,
    /// Measurement function(s) seen, in order of first appearance (e.g. ["VOLT:DC"]).
    pub functions: Vec<String>,
    pub serial: Option<String>,
    #[serde(default)]
    pub markers: Vec<Marker>,
}

/// What clients see about the session in progress (part of `MeterState`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub id: String,
    pub name: String,
    pub started: i64,
    pub duration_ms: Option<u64>,
}

struct Active {
    meta: SessionMeta,
    writer: BufWriter<File>,
    last_flush: Instant,
}

/// How often buffered rows (and the running count in the meta file) hit the disk.
const FLUSH_EVERY: Duration = Duration::from_secs(2);

pub struct Recorder {
    dir: Option<PathBuf>,
    active: Option<Active>,
}

impl Recorder {
    /// `dir` None disables recording (e.g. no writable data dir configured).
    pub fn new(dir: Option<PathBuf>) -> Self {
        Self { dir, active: None }
    }

    pub fn available(&self) -> bool {
        self.dir.is_some()
    }

    pub fn info(&self) -> Option<RecordingInfo> {
        self.active.as_ref().map(|a| RecordingInfo {
            id: a.meta.id.clone(),
            name: a.meta.name.clone(),
            started: a.meta.started,
            duration_ms: a.meta.duration_ms,
        })
    }

    /// Begin a new session (finishing any current one first).
    pub fn start(
        &mut self,
        name: &str,
        duration_ms: Option<u64>,
        serial: Option<String>,
        now_ms: i64,
    ) -> io::Result<RecordingInfo> {
        let dir = self
            .dir
            .clone()
            .ok_or_else(|| io::Error::other("recording is not available (no data directory)"))?;
        self.stop(now_ms)?;
        fs::create_dir_all(&dir)?;
        let id = unique_id(&dir, now_ms);
        let name = match name.trim() {
            "" => format!(
                "Session {}",
                crate::csv_log::iso8601_ms(now_ms)[..16].replace('T', " ")
            ),
            n => n.chars().take(120).collect(),
        };
        let mut writer = BufWriter::new(
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(dir.join(format!("{id}.csv")))?,
        );
        writer.write_all(CSV_HEADER.as_bytes())?;
        let meta = SessionMeta {
            id,
            name,
            started: now_ms,
            ended: None,
            duration_ms: duration_ms.filter(|&d| d > 0),
            count: 0,
            functions: Vec::new(),
            serial,
            markers: Vec::new(),
        };
        write_meta(&dir, &meta)?;
        self.active = Some(Active {
            meta,
            writer,
            last_flush: Instant::now(),
        });
        Ok(self.info().unwrap())
    }

    /// Append one formatted CSV row. Returns true when this row completed a timed
    /// session (the recorder has stopped itself and the caller should publish).
    pub fn push(&mut self, row: &str, function: &str, ts: i64) -> io::Result<bool> {
        let Some(a) = self.active.as_mut() else {
            return Ok(false);
        };
        a.writer.write_all(row.as_bytes())?;
        a.meta.count += 1;
        if !a.meta.functions.iter().any(|f| f == function) {
            a.meta.functions.push(function.to_string());
        }
        if a.last_flush.elapsed() >= FLUSH_EVERY {
            a.writer.flush()?;
            a.last_flush = Instant::now();
            if let Some(dir) = &self.dir {
                write_meta(dir, &a.meta)?;
            }
        }
        let done = a
            .meta
            .duration_ms
            .is_some_and(|d| ts - a.meta.started >= d as i64);
        if done {
            self.stop(ts)?;
        }
        Ok(done)
    }

    /// Pin a marker to the current session (no-op when not recording).
    pub fn mark(&mut self, marker: Marker) -> io::Result<()> {
        if let (Some(a), Some(dir)) = (self.active.as_mut(), &self.dir) {
            a.meta.markers.push(marker);
            write_meta(dir, &a.meta)?;
        }
        Ok(())
    }

    /// Finish the current session, if any, and return its final metadata.
    pub fn stop(&mut self, now_ms: i64) -> io::Result<Option<SessionMeta>> {
        let Some(mut a) = self.active.take() else {
            return Ok(None);
        };
        a.writer.flush()?;
        a.meta.ended = Some(now_ms);
        if let Some(dir) = &self.dir {
            write_meta(dir, &a.meta)?;
        }
        Ok(Some(a.meta))
    }
}

fn unique_id(dir: &Path, now_ms: i64) -> String {
    // Sortable and human-readable: 20261017-062015 (UTC), suffixed on collision.
    let iso = crate::csv_log::iso8601_ms(now_ms);
    let base: String = iso[..19].chars().filter(|c| c.is_ascii_digit()).collect();
    let base = format!("{}-{}", &base[..8], &base[8..]);
    let mut id = base.clone();
    let mut n = 2;
    while dir.join(format!("{id}.csv")).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

fn write_meta(dir: &Path, meta: &SessionMeta) -> io::Result<()> {
    // Write-then-rename so a crash never leaves a truncated meta file.
    let tmp = dir.join(format!("{}.json.tmp", meta.id));
    fs::write(&tmp, serde_json::to_vec_pretty(meta)?)?;
    fs::rename(tmp, dir.join(format!("{}.json", meta.id)))
}

/// Ids come from clients; only accept what `unique_id` produces.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_digit() || c == '-')
}

/// All sessions in `dir`, newest first.
pub fn list(dir: &Path) -> Vec<SessionMeta> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<SessionMeta> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_slice(&fs::read(e.path()).ok()?).ok())
        .collect();
    out.sort_by_key(|m| std::cmp::Reverse(m.started));
    out
}

pub fn meta(dir: &Path, id: &str) -> Option<SessionMeta> {
    if !valid_id(id) {
        return None;
    }
    serde_json::from_slice(&fs::read(dir.join(format!("{id}.json"))).ok()?).ok()
}

pub fn csv_path(dir: &Path, id: &str) -> Option<PathBuf> {
    valid_id(id)
        .then(|| dir.join(format!("{id}.csv")))
        .filter(|p| p.exists())
}

pub fn delete(dir: &Path, id: &str) -> io::Result<()> {
    if !valid_id(id) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad id"));
    }
    for ext in ["csv", "json"] {
        match fs::remove_file(dir.join(format!("{id}.{ext}"))) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
    }
    Ok(())
}

/// A session's readings reduced to at most ~`max_points` for charting.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub meta: SessionMeta,
    /// Epoch ms per point.
    pub ts: Vec<i64>,
    /// Base-unit values; None = overload.
    pub values: Vec<Option<f64>>,
    pub unit: String,
    pub function: String,
    /// Rows in the file (before decimation).
    pub total: u64,
}

/// Load a session for plotting. Long sessions are decimated by min/max per time
/// bucket, which keeps spikes and dropouts visible (a plain stride would hide them).
pub fn load_data(dir: &Path, id: &str, max_points: usize) -> io::Result<SessionData> {
    let meta = meta(dir, id).ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
    let path = csv_path(dir, id).ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
    let mut rows: Vec<(i64, Option<f64>)> = Vec::new();
    let mut unit = String::new();
    let mut function = String::new();
    for line in BufReader::new(File::open(path)?).lines().skip(1) {
        let line = line?;
        // seq,serial,datetime,function,value,unit
        let mut it = line.split(',');
        let (Some(_), Some(_), Some(dt), Some(func), Some(val), Some(u)) = (
            it.next(),
            it.next(),
            it.next(),
            it.next(),
            it.next(),
            it.next(),
        ) else {
            continue;
        };
        let Some(ts) = parse_iso8601_ms(dt) else {
            continue;
        };
        if function.is_empty() {
            function = func.to_string();
            unit = u.trim().to_string();
        }
        rows.push((ts, val.parse::<f64>().ok()));
    }
    let total = rows.len() as u64;
    let rows = decimate_min_max(rows, max_points.max(2));
    let (ts, values) = rows.into_iter().unzip();
    Ok(SessionData {
        meta,
        ts,
        values,
        unit,
        function,
        total,
    })
}

/// Keep each bucket's first min and max (in time order) — 2 points per bucket.
fn decimate_min_max(rows: Vec<(i64, Option<f64>)>, max_points: usize) -> Vec<(i64, Option<f64>)> {
    if rows.len() <= max_points {
        return rows;
    }
    let buckets = max_points / 2;
    let per = rows.len().div_ceil(buckets);
    let mut out = Vec::with_capacity(buckets * 2);
    for chunk in rows.chunks(per) {
        // An overload inside the bucket is kept as a gap so it still shows.
        if let Some(gap) = chunk.iter().find(|r| r.1.is_none()) {
            out.push(*gap);
        }
        let finite = chunk.iter().filter(|r| r.1.is_some());
        let lo = finite.clone().min_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
        let hi = finite.max_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
        match (lo, hi) {
            (Some(lo), Some(hi)) if lo.0 <= hi.0 => out.extend([*lo, *hi]),
            (Some(lo), Some(hi)) => out.extend([*hi, *lo]),
            _ => {}
        }
    }
    out.sort_by_key(|r| r.0);
    out.dedup();
    out
}

/// Inverse of [`crate::csv_log::iso8601_ms`] for `YYYY-MM-DDTHH:MM:SS.mmmZ`.
pub fn parse_iso8601_ms(s: &str) -> Option<i64> {
    let s = s.trim().strip_suffix('Z')?;
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let (hms, ms) = time.split_once('.').unwrap_or((time, "0"));
    let mut t = hms.split(':').map(|p| p.parse::<i64>().ok());
    let (hh, mm, ss) = (t.next()??, t.next()??, t.next()??);
    let ms: i64 = ms.parse().ok()?;
    // days_from_civil (Howard Hinnant).
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + hh * 3600 + mm * 60 + ss) * 1000) + ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::csv_log::iso8601_ms;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "scpi-sessions-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn iso_roundtrip() {
        for ms in [
            0,
            1_000,
            946_684_800_000,
            1_709_209_845_123,
            1_760_681_415_869,
        ] {
            assert_eq!(parse_iso8601_ms(&iso8601_ms(ms)), Some(ms));
        }
        assert_eq!(parse_iso8601_ms("garbage"), None);
    }

    #[test]
    fn record_list_load_delete() {
        let dir = tmpdir("lifecycle");
        let mut rec = Recorder::new(Some(dir.clone()));
        let t0 = 1_760_681_415_000;
        let info = rec
            .start("bench test", None, Some("SN1".into()), t0)
            .unwrap();
        for i in 0..10 {
            let ts = t0 + i * 100;
            let row = format!(
                "{},SN1,{},VOLT:DC,{},V\n",
                i + 1,
                iso8601_ms(ts),
                if i == 5 {
                    "OL".to_string()
                } else {
                    format!("{}", i as f64 * 0.1)
                }
            );
            assert!(!rec.push(&row, "VOLT:DC", ts).unwrap());
        }
        rec.mark(Marker {
            ts: t0 + 500,
            text: "poke".into(),
        })
        .unwrap();
        let meta = rec.stop(t0 + 1000).unwrap().unwrap();
        assert_eq!(meta.count, 10);
        assert_eq!(meta.functions, vec!["VOLT:DC"]);

        let listed = list(&dir);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, info.id);
        assert_eq!(listed[0].markers.len(), 1);

        let data = load_data(&dir, &info.id, 1000).unwrap();
        assert_eq!(data.total, 10);
        assert_eq!(data.values[5], None);
        assert_eq!(data.unit, "V");
        assert_eq!(data.ts[0], t0);

        delete(&dir, &info.id).unwrap();
        assert!(list(&dir).is_empty());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn timed_session_stops_itself() {
        let dir = tmpdir("timed");
        let mut rec = Recorder::new(Some(dir.clone()));
        rec.start("", Some(250), None, 0).unwrap();
        assert!(!rec.push("1,,x,VOLT:DC,1,V\n", "VOLT:DC", 100).unwrap());
        assert!(rec.push("2,,x,VOLT:DC,1,V\n", "VOLT:DC", 300).unwrap());
        assert!(rec.info().is_none());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn decimation_keeps_extremes() {
        let mut rows: Vec<(i64, Option<f64>)> = (0..10_000).map(|i| (i, Some(0.0))).collect();
        rows[4321].1 = Some(9.0); // a single spike
        rows[7000].1 = None; // and a dropout
        let out = decimate_min_max(rows, 200);
        assert!(out.len() <= 210);
        assert!(out.iter().any(|r| r.1 == Some(9.0)));
        assert!(out.iter().any(|r| r.1.is_none()));
    }

    #[test]
    fn rejects_path_traversal_ids() {
        assert!(!valid_id("../etc/passwd"));
        assert!(!valid_id(""));
        assert!(valid_id("20261017-062015-2"));
    }
}
