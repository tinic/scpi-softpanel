import { computed } from 'vue'
import { FUNCTION_INFO, type MeterFunction } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { useTempUnit } from '@/composables/useTempUnit'
import { useMath } from '@/composables/useMath'
import {
  axisScale,
  convertTemp,
  formatContinuity,
  formatValue,
  functionUnitSuffix,
  tempUnitLabel,
  type Formatted,
} from '@/lib/format'
import { applyMath, isSiUnit, mathLabel } from '@/lib/math'

/**
 * The "display channel": how the current function's readings are turned into what
 * the readout, statistics, charts and limits all show — temperature unit conversion,
 * then the math channel — and how those numbers are formatted. One place, so every
 * view agrees on the value and its unit (e.g. the trend axis reads "mVDC" just like
 * the big digits).
 */

type Kind =
  | { type: 'si'; unit: string; suffix: string } // SI-prefixed: "2.9827 mVDC"
  | { type: 'fixed'; unit: string; decimals: number } // "23.4 °C", "-3.21 dBm"
  | { type: 'plain'; unit: string } // 5 significant figures: "14.502 psi"
  | { type: 'cont' } // continuity: "0.4 Ω" / "open"

export interface Channel {
  fn: MeterFunction | null
  /** Function name, e.g. "DC Voltage". */
  label: string
  /** Math annunciator text when math is active, else ''. */
  mathTag: string
  /** Raw reading → display value (temperature converted, math applied). */
  value(r: { value: number; function?: string }): number
  /** Display value → readout text. `delta` formats a spread (σ, p-p) with one more
   *  decimal on fixed-resolution units so small spreads don't round to zero. */
  format(v: number, opts?: { delta?: boolean }): Formatted
  /** Axis scaling for a chart whose largest |value| is `maxAbs`. */
  axis(maxAbs: number): { div: number; unit: string }
  /** Unit strings a typed-in limit may end with (stripped before parsing). */
  entryUnits: string[]
  /** Unit label for an entry field ("V", "°C", "dBm"). */
  entryUnit: string
}

function plain(v: number, unit: string, digits = 5): Formatted {
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  const text =
    a !== 0 && (a >= 1e6 || a < 1e-3) ? a.toExponential(digits - 1) : a.toPrecision(digits)
  return { sign, text, unit }
}

export function useDisplay() {
  const store = useMeterStore()
  const { tempUnit } = useTempUnit()
  const math = useMath()

  const channel = computed<Channel>(() => {
    const fn = store.state?.function ?? null
    const info = fn ? FUNCTION_INFO[fn] : null
    const isTemp = fn === 'TEMP'
    const cfg = math.config.value
    const mathOn = math.active.value

    let kind: Kind
    if (mathOn && cfg.mode === 'mxb') {
      kind = isSiUnit(cfg.unit)
        ? { type: 'si', unit: cfg.unit, suffix: '' }
        : { type: 'plain', unit: cfg.unit }
    } else if (mathOn && (cfg.mode === 'db' || cfg.mode === 'dbm')) {
      kind = { type: 'fixed', unit: cfg.mode === 'db' ? 'dB' : 'dBm', decimals: 2 }
    } else if (mathOn && cfg.mode === 'pct') {
      kind = { type: 'fixed', unit: '%', decimals: 3 }
    } else if (fn === 'CONT') {
      kind = { type: 'cont' }
    } else if (isTemp) {
      kind = { type: 'fixed', unit: tempUnitLabel(tempUnit.value), decimals: 1 }
    } else {
      kind = { type: 'si', unit: info?.unit ?? '', suffix: functionUnitSuffix(fn ?? undefined) }
    }

    const value = (r: { value: number; function?: string }) => {
      let v = r.value
      if (r.function === 'TEMP') v = convertTemp(v, tempUnit.value)
      return mathOn ? applyMath(v, cfg) : v
    }

    const format = (v: number, opts?: { delta?: boolean }): Formatted => {
      switch (kind.type) {
        case 'cont':
          return opts?.delta ? formatValue(v, 'Ω', 3) : formatContinuity(v)
        case 'fixed': {
          if (!Number.isFinite(v)) {
            // −∞ dB is a real answer (0 V in); anything else non-finite is overload.
            const isLog = kind.unit === 'dB' || kind.unit === 'dBm'
            return { sign: v < 0 ? '-' : '', text: isLog ? '∞' : 'OL', unit: kind.unit }
          }
          const d = kind.decimals + (opts?.delta ? 1 : 0)
          return { sign: v < 0 ? '-' : '', text: Math.abs(v).toFixed(d), unit: kind.unit }
        }
        case 'plain':
          return Number.isFinite(v)
            ? plain(v, kind.unit)
            : { sign: '', text: 'OL', unit: kind.unit }
        case 'si': {
          const f = formatValue(v, kind.unit)
          return { ...f, unit: f.unit + kind.suffix }
        }
      }
    }

    const axis = (maxAbs: number) => {
      if (kind.type === 'si') {
        const a = axisScale(maxAbs, kind.unit)
        return { div: a.div, unit: a.unit + kind.suffix }
      }
      return { div: 1, unit: kind.type === 'cont' ? 'Ω' : kind.unit }
    }

    const entryUnit = kind.type === 'cont' ? 'Ω' : kind.type === 'si' ? kind.unit : kind.unit
    const entryUnits =
      kind.type === 'si' && kind.suffix ? [kind.unit + kind.suffix, kind.unit] : [entryUnit]

    return {
      fn,
      label: info?.label ?? '—',
      mathTag: mathOn ? mathLabel(cfg) : '',
      value,
      format,
      axis,
      entryUnit,
      entryUnits,
    }
  })

  return { channel }
}

/** Format a value for an input field: engineering notation without the sign split,
 *  e.g. "2.95m" for 0.00295 on an SI channel. */
export function toEntry(ch: Channel, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return ''
  const f = ch.format(v)
  const prefix = f.unit.replace(ch.entryUnits[0], '').replace(ch.entryUnit, '')
  // Strip trailing zeros so "2.9500" reads "2.95".
  const num = String(Number.parseFloat(f.text))
  return `${f.sign}${num}${prefix}`
}
