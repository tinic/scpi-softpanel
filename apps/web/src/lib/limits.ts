/**
 * Limit testing (pass/fail against a low and/or high bound), like a DMM's Limits
 * math. Either bound may be absent for a one-sided test. Overload always fails.
 */

export interface Limits {
  enabled: boolean
  lo: number | null
  hi: number | null
}

export type Verdict = 'pass' | 'lo' | 'hi'

export const NO_LIMITS: Limits = { enabled: false, lo: null, hi: null }

/** Test one value; null when limits are off or have no bound set. */
export function evaluate(v: number, lim: Limits): Verdict | null {
  if (!lim.enabled || (lim.lo == null && lim.hi == null)) return null
  if (Number.isNaN(v)) return null
  if (!Number.isFinite(v)) return v < 0 ? 'lo' : 'hi'
  if (lim.lo != null && v < lim.lo) return 'lo'
  if (lim.hi != null && v > lim.hi) return 'hi'
  return 'pass'
}

/** Limits from a nominal value and a ± tolerance in percent. */
export function fromTolerance(nominal: number, pct: number): { lo: number; hi: number } {
  const d = Math.abs(nominal) * (pct / 100)
  return { lo: nominal - d, hi: nominal + d }
}
