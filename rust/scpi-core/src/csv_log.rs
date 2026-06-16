//! Bounded, in-memory CSV export buffer for the readings download.
//!
//! Pre-formatted CSV rows accumulate into ~1 MiB byte blocks held in a `VecDeque`.
//! Once the total exceeds the cap, the oldest *whole block* is dropped — O(1), with no
//! per-row shifting. It's a rolling export buffer with no persistence or querying,
//! which is exactly why it's a `VecDeque<Vec<u8>>` and not SQLite.

use std::collections::VecDeque;

/// Seal a block once it reaches this size (the "1 MB+ blocks" requirement).
pub const BLOCK_TARGET_BYTES: usize = 1 << 20; // 1 MiB
/// Cap across all retained blocks.
pub const TOTAL_CAP_BYTES: usize = 256 << 20; // 256 MiB

pub const CSV_HEADER: &str = "seq,serial,datetime,value,unit\n";

pub struct CsvLog {
    /// Sealed blocks, oldest first; each is >= `block_target` bytes.
    blocks: VecDeque<Vec<u8>>,
    /// The block currently being filled (always newest; never evicted).
    current: Vec<u8>,
    /// Bytes across `blocks` + `current`.
    total: usize,
    block_target: usize,
    cap: usize,
}

impl CsvLog {
    pub fn new(block_target: usize, cap: usize) -> Self {
        let block_target = block_target.max(1);
        Self {
            blocks: VecDeque::new(),
            current: Vec::new(),
            total: 0,
            block_target,
            cap: cap.max(block_target),
        }
    }

    /// Append one already-formatted CSV row (must end in `\n`).
    pub fn push_row(&mut self, row: &str) {
        self.current.extend_from_slice(row.as_bytes());
        self.total += row.len();
        if self.current.len() >= self.block_target {
            self.blocks.push_back(std::mem::take(&mut self.current));
        }
        // Drop whole oldest blocks until back under the cap (the in-progress block,
        // being newest and < block_target, is never evicted).
        while self.total > self.cap {
            match self.blocks.pop_front() {
                Some(b) => self.total -= b.len(),
                None => break,
            }
        }
    }

    /// The full CSV (header + every retained row) as one buffer.
    pub fn to_csv(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(CSV_HEADER.len() + self.total);
        out.extend_from_slice(CSV_HEADER.as_bytes());
        for b in &self.blocks {
            out.extend_from_slice(b);
        }
        out.extend_from_slice(&self.current);
        out
    }

    pub fn bytes(&self) -> usize {
        self.total
    }
}

/// Format an epoch-millisecond timestamp as ISO-8601 UTC, e.g. `2026-06-16T04:55:12.345Z`.
/// Pure arithmetic (Howard Hinnant's civil-from-days), so no chrono/time dependency.
pub fn iso8601_ms(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (hh, mm, ss) = (tod / 3600, (tod % 3600) / 60, tod % 60);

    // days since 1970-01-01 -> civil (y, m, d).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.{millis:03}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_known_instants() {
        assert_eq!(iso8601_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso8601_ms(1_000), "1970-01-01T00:00:01.000Z");
        assert_eq!(iso8601_ms(946_684_800_000), "2000-01-01T00:00:00.000Z");
        // 2024-02-29 (leap day) 12:30:45.123
        assert_eq!(iso8601_ms(1_709_209_845_123), "2024-02-29T12:30:45.123Z");
    }

    #[test]
    fn evicts_oldest_block_past_cap() {
        // Small sizes: 100-byte blocks, 250-byte cap.
        let mut log = CsvLog::new(100, 250);
        let row = format!("{}\n", "x".repeat(60)); // 61 bytes
        for _ in 0..50 {
            log.push_row(&row);
        }
        // Bounded near the cap (at most cap + one in-progress block over).
        assert!(log.bytes() <= 250 + 100 + 61);
        let csv = log.to_csv();
        assert!(csv.starts_with(CSV_HEADER.as_bytes()));
        assert!(csv.len() > CSV_HEADER.len());
    }
}
