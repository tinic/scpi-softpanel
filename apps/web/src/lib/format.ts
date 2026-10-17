const PREFIXES: Array<{ exp: number; sym: string }> = [
  { exp: -12, sym: 'p' },
  { exp: -9, sym: 'n' },
  { exp: -6, sym: 'µ' },
  { exp: -3, sym: 'm' },
  { exp: 0, sym: '' },
  { exp: 3, sym: 'k' },
  { exp: 6, sym: 'M' },
  { exp: 9, sym: 'G' },
]

export interface Formatted {
  /** '-' for negatives, '' otherwise. Kept separate so callers can reserve a fixed
   *  sign column and stop the digits from shifting when the value crosses zero. */
  sign: string
  /** Magnitude only (never carries the sign). */
  text: string
  unit: string
}

/**
 * Engineering-notation formatter: scales `value` to a sensible SI prefix and renders
 * the magnitude with `digits` significant figures. The sign is returned separately.
 * Non-finite values (overload) render as "OL".
 */
export function formatValue(value: number, unit: string, digits = 5): Formatted {
  if (!Number.isFinite(value)) return { sign: value < 0 ? '-' : '', text: 'OL', unit }
  if (value === 0) return { sign: '', text: (0).toFixed(digits - 1), unit }

  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const prefix = siPrefixFor(abs)
  const scaled = abs / 10 ** prefix.exp
  return { sign, text: scaled.toPrecision(digits), unit: prefix.sym + unit }
}

/**
 * Continuity-mode formatter. Sub-ohm engineering notation ("80.850 mΩ") is noise
 * here — readings show in plain ohms at 0.1 Ω resolution, and an open circuit
 * reads "open" instead of the generic OL.
 */
export function formatContinuity(value: number): Formatted {
  if (!Number.isFinite(value)) return { sign: '', text: 'open', unit: '' }
  return { sign: value < 0 ? '-' : '', text: Math.abs(value).toFixed(1), unit: 'Ω' }
}

/**
 * DC/AC suffix appended to the V/A unit so the readout labels like a bench DMM
 * (VDC, VAC, ADC, AAC). Empty for functions with no DC/AC distinction — resistance,
 * diode, capacitance, frequency, temperature, continuity.
 */
export function functionUnitSuffix(fn?: string): string {
  switch (fn) {
    case 'VOLT:DC':
    case 'CURR:DC':
      return 'DC'
    case 'VOLT:AC':
    case 'CURR:AC':
      return 'AC'
    default:
      return ''
  }
}

export type TempUnit = 'C' | 'F' | 'K'

/** Convert a Celsius reading (what the meter reports) to the chosen display unit. */
export function convertTemp(celsius: number, unit: TempUnit): number {
  if (unit === 'F') return celsius * 1.8 + 32
  if (unit === 'K') return celsius + 273.15
  return celsius
}

export function tempUnitLabel(unit: TempUnit): string {
  return unit === 'K' ? 'K' : unit === 'F' ? '°F' : '°C'
}

/**
 * Temperature: convert the meter's °C value to the chosen display unit (°F and K are
 * derived in software — the meter stays in °C) and render at 0.1° resolution with no
 * SI prefix, so a near-zero reading isn't shown as "500 m°C".
 */
export function formatTemperature(celsius: number, unit: TempUnit): Formatted {
  const label = tempUnitLabel(unit)
  if (!Number.isFinite(celsius)) return { sign: celsius < 0 ? '-' : '', text: 'OL', unit: label }
  const v = convertTemp(celsius, unit)
  return { sign: v < 0 ? '-' : '', text: Math.abs(v).toFixed(1), unit: label }
}

/**
 * Format a reading with a function-aware unit: VDC/VAC/ADC/AAC for the voltage and
 * current functions (so e.g. a DC millivolt reads "mVDC"), plain ohms for continuity,
 * the chosen °C/°F/K for temperature, otherwise the SI-prefixed unit (mV, kΩ, …).
 * Single entry point so the main display, the min/avg/max stats, and the trend
 * tooltip all label identically.
 */
export function formatReading(
  r: { value: number; unit: string; function?: string },
  tempUnit: TempUnit = 'C',
): Formatted {
  if (r.function === 'CONT') return formatContinuity(r.value)
  if (r.function === 'TEMP') return formatTemperature(r.value, tempUnit)
  const f = formatValue(r.value, r.unit)
  return { ...f, unit: f.unit + functionUnitSuffix(r.function) }
}

/** The SI prefix a magnitude would be shown with (the one `formatValue` picks). */
export function siPrefixFor(abs: number): { exp: number; sym: string } {
  if (!Number.isFinite(abs) || abs === 0) return PREFIXES[4]
  for (let i = PREFIXES.length - 1; i >= 0; i--) {
    if (abs >= 10 ** PREFIXES[i].exp) return PREFIXES[i]
  }
  return PREFIXES[4] // below pico: leave unprefixed rather than "0.0001 p"
}

/**
 * One SI prefix for a whole chart axis, chosen from the largest magnitude on it, so
 * ticks read "2.950" against an axis unit of "mV" instead of "0.00295" in bare volts.
 * `div` is what plotted values are divided by.
 */
export function axisScale(maxAbs: number, unit: string): { div: number; unit: string } {
  const p = siPrefixFor(maxAbs)
  return { div: 10 ** p.exp, unit: p.sym + unit }
}

const PARSE_PREFIX: Record<string, number> = {
  p: -12,
  n: -9,
  u: -6,
  µ: -6,
  μ: -6,
  m: -3,
  k: 3,
  M: 6,
  G: 9,
}

/**
 * Parse an engineering-notation entry like "2.95m", "4k7", "-3.3", "10 µ", "1e-3"
 * into a number. Any of `units` written after the value is ignored, so "2.95 mV"
 * parses as 0.00295 when `units` includes "V". After that only a single SI prefix may
 * remain — "3 psi" is not misread as pico. Returns null for anything else.
 */
export function parseEng(text: string, units: string[] = []): number | null {
  let t = text.trim().replace(',', '.')
  for (const u of [...units].sort((a, b) => b.length - a.length)) {
    if (u && t.endsWith(u)) {
      t = t.slice(0, -u.length).trim()
      break
    }
  }
  if (!t) return null
  // Resistor-style "4k7" (the prefix stands in for the decimal point).
  const rkm = /^([+-]?\d+)([pnuµμmkMG])(\d+)$/.exec(t)
  if (rkm) return Number.parseFloat(`${rkm[1]}.${rkm[3]}`) * 10 ** PARSE_PREFIX[rkm[2]]
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(\S?)$/.exec(t)
  if (!m) return null
  const n = Number.parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  if (!m[2]) return n
  const exp = PARSE_PREFIX[m[2]]
  return exp === undefined ? null : n * 10 ** exp
}

/**
 * Compact label for a range button, e.g. 0.2 V -> "200 mV", 1e8 Ω -> "100 MΩ".
 * Voltage ranges stay in volts ("1000 V", not "1 kV") to match the front panel.
 */
export function formatRangeLabel(value: number, unit: string): string {
  if (unit === 'V' && value >= 1000) return `${value} V`
  const f = formatValue(value, unit, 6)
  return `${Number.parseFloat(f.text)} ${f.unit}`
}

/** A duration as h:mm:ss (e.g. "1:02:03"; "0:00:42"). */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/** Decimals needed to print every multiple of `incr` exactly (0.025 → 3, 0.5 → 1). */
export function stepDecimals(incr: number): number {
  if (!Number.isFinite(incr) || incr <= 0) return 3
  for (let d = 0; d < 10; d++) {
    const scaled = incr * 10 ** d
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, scaled)) return d
  }
  return 9
}
