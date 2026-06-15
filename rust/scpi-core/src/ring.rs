//! Bounded in-memory reading history (the broker's ring buffer). Port of
//! `RingReadingStore`; oldest entries drop once capacity is exceeded.

use std::collections::VecDeque;

use crate::messages::Reading;

pub struct RingStore {
    buf: VecDeque<Reading>,
    capacity: usize,
}

impl RingStore {
    pub fn new(capacity: usize) -> Self {
        Self {
            buf: VecDeque::with_capacity(capacity.min(4096)),
            capacity: capacity.max(1),
        }
    }

    pub fn push(&mut self, r: Reading) {
        if self.buf.len() == self.capacity {
            self.buf.pop_front();
        }
        self.buf.push_back(r);
    }

    /// Most recent `n` readings (all of them when `n` is None), oldest first.
    pub fn recent(&self, n: Option<usize>) -> Vec<Reading> {
        let take = n.unwrap_or(self.buf.len()).min(self.buf.len());
        self.buf
            .iter()
            .skip(self.buf.len() - take)
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading(ts: i64) -> Reading {
        Reading {
            ts,
            value: ts as f64,
            unit: "V".into(),
            function: "VOLT:DC".into(),
            overload: false,
            raw: None,
        }
    }

    #[test]
    fn drops_oldest_past_capacity() {
        let mut s = RingStore::new(3);
        for i in 0..5 {
            s.push(reading(i));
        }
        let all = s.recent(None);
        assert_eq!(all.len(), 3);
        assert_eq!(all.first().unwrap().ts, 2);
        assert_eq!(all.last().unwrap().ts, 4);
    }

    #[test]
    fn recent_caps_to_len() {
        let mut s = RingStore::new(10);
        s.push(reading(1));
        assert_eq!(s.recent(Some(5)).len(), 1);
    }
}
