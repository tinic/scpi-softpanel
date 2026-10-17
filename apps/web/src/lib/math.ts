/**
 * Math channel: a transform applied to each reading before it's displayed, charted,
 * and limit-tested — the bench DMM's Math menu. Pure functions; the per-function
 * configuration lives in `useMath`.
 *
 *   mxb  m·x + b with a custom unit — scale a shunt voltage to amps, a transducer
 *        to psi, a divider back to the source voltage, …
 *   db   20·log10(|V| / Vref): gain/attenuation against a reference voltage
 *   dbm  10·log10(V² / R / 1 mW): power into a reference impedance
 *   pct  (x − nominal) / |nominal| · 100: deviation from a nominal value
 */

export type MathMode = 'off' | 'mxb' | 'db' | 'dbm' | 'pct'

export interface MathConfig {
  mode: MathMode
  m: number
  b: number
  /** Unit label shown for the mX+b result (free text, e.g. "A", "psi"). */
  unit: string
  /** dB reference voltage, volts. */
  refV: number
  /** dBm reference impedance, ohms. */
  refOhm: number
  /** % deviation nominal, in the measurement's base unit. */
  nominal: number
}

export const DEFAULT_MATH: MathConfig = {
  mode: 'off',
  m: 1,
  b: 0,
  unit: '',
  refV: 1,
  refOhm: 600,
  nominal: 1,
}

export const MATH_MODES: { id: MathMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Show the measurement as-is' },
  { id: 'mxb', label: 'mX+b', hint: 'Linear scaling with a custom unit' },
  { id: 'pct', label: '% dev', hint: 'Deviation from a nominal value' },
  { id: 'db', label: 'dB', hint: '20·log10(V / Vref)' },
  { id: 'dbm', label: 'dBm', hint: 'Power into a reference impedance' },
]

/** Common dBm reference impedances (audio, RF, video, line). */
export const DBM_IMPEDANCES = [50, 75, 600, 1000]

/** Whether `mode` makes sense for a measurement function. */
export function mathApplies(mode: MathMode, fn: string | null | undefined): boolean {
  if (mode === 'off' || !fn || fn === 'CONT') return false
  if (mode === 'db' || mode === 'dbm') return fn === 'VOLT:AC' || fn === 'VOLT:DC'
  return true
}

/**
 * Apply the math to one value. Non-finite input (overload) passes through as is so
 * callers still recognize it; a zero voltage in dB/dBm is −∞, which is honest.
 */
export function applyMath(v: number, cfg: MathConfig): number {
  if (!Number.isFinite(v)) return v
  switch (cfg.mode) {
    case 'mxb':
      return cfg.m * v + cfg.b
    case 'db':
      return 20 * Math.log10(Math.abs(v) / cfg.refV)
    case 'dbm':
      return 10 * Math.log10((v * v) / cfg.refOhm / 1e-3)
    case 'pct':
      return cfg.nominal === 0 ? NaN : ((v - cfg.nominal) / Math.abs(cfg.nominal)) * 100
    default:
      return v
  }
}

/** Short label for the annunciator / readout title, e.g. "dBm 600Ω". */
export function mathLabel(cfg: MathConfig): string {
  switch (cfg.mode) {
    case 'mxb':
      return 'mX+b'
    case 'db':
      return 'dB'
    case 'dbm':
      return `dBm ${cfg.refOhm}Ω`
    case 'pct':
      return '% dev'
    default:
      return ''
  }
}

/** Units that read naturally with SI prefixes (mA, kPa, µW); anything else (psi, %,
 *  rpm) is shown with plain significant figures. */
const SI_UNITS = new Set(['V', 'A', 'W', 'Ω', 'F', 'H', 'Hz', 's', 'Pa', 'N', 'g', 'J', 'S'])
export function isSiUnit(unit: string): boolean {
  return SI_UNITS.has(unit.trim())
}
