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
  let prefix = PREFIXES[4]
  for (let i = PREFIXES.length - 1; i >= 0; i--) {
    if (abs >= 10 ** PREFIXES[i].exp) {
      prefix = PREFIXES[i]
      break
    }
  }
  const scaled = abs / 10 ** prefix.exp
  return { sign, text: scaled.toPrecision(digits), unit: prefix.sym + unit }
}
