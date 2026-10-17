/**
 * Measurement statistics over a window of readings: the numbers a bench DMM's
 * Statistics menu shows (N, mean, σ, min, max, peak-to-peak), plus a "stable"
 * test for telling when a reading has settled.
 */

export interface Summary {
  n: number
  mean: number
  /** Sample standard deviation (n − 1); 0 for a single reading. */
  std: number
  min: number
  max: number
  pp: number
}

/** Summarize finite values in one pass (Welford's update, so it stays exact-ish for
 *  long windows of nearly identical readings). Null when there are none. */
export function summarize(values: Iterable<number>): Summary | null {
  let n = 0
  let mean = 0
  let m2 = 0
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    n++
    const d = v - mean
    mean += d / n
    m2 += d * (v - mean)
    if (v < min) min = v
    if (v > max) max = v
  }
  if (n === 0) return null
  return { n, mean, std: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0, min, max, pp: max - min }
}

/** How many of the most recent readings must agree before a value counts as stable. */
export const STABLE_COUNT = 8

/**
 * Smallest spread worth calling "unstable": ~5 counts of a 4½-digit display at the
 * value's decade, so a reading near zero (where a relative tolerance collapses) isn't
 * flagged as wandering by its last digit flickering.
 */
export function countFloor(value: number): number {
  const abs = Math.abs(value)
  if (!Number.isFinite(abs) || abs === 0) return 0
  return 5 * 10 ** (Math.floor(Math.log10(abs)) - 4)
}

/**
 * True when the last `count` values all sit within `tolRel` (fraction, e.g. 0.001 =
 * 0.1 %) of their mean, or within the display-count floor — whichever is looser.
 * Any overload (non-finite) value in the window means not stable.
 */
export function isStable(recent: number[], tolRel: number, count = STABLE_COUNT): boolean {
  if (recent.length < count) return false
  const tail = recent.slice(-count)
  if (tail.some((v) => !Number.isFinite(v))) return false
  const s = summarize(tail)!
  const tol = Math.max(Math.abs(s.mean) * tolRel, countFloor(s.mean))
  return s.pp <= tol * 2
}
