/**
 * Static metadata about the measurement functions the SDM3045X exposes, plus the
 * SCPI strings needed to drive each one. Kept in `shared` so the server (command
 * generation) and the web UI (controls/labels) agree on exactly one source of truth.
 */

export const METER_FUNCTIONS = [
  'VOLT:DC',
  'VOLT:AC',
  'CURR:DC',
  'CURR:AC',
  'RES',
  'FRES',
  'CAP',
  'FREQ',
  'PER',
  'CONT',
  'DIOD',
  'TEMP',
] as const

export type MeterFunction = (typeof METER_FUNCTIONS)[number]

export interface FunctionInfo {
  /** Canonical id used across the wire. */
  id: MeterFunction
  /** Human label for the UI. */
  label: string
  /** Short front-panel-style label for the function key grid. */
  short: string
  /** Display unit. */
  unit: string
  /** `CONFigure` command that selects this function. */
  conf: string
  /** `SENSe` subsystem prefix for RANGe/NPLC queries, or null when not applicable. */
  sense: string | null
  /** Whether integration time (NPLC) applies. */
  supportsNplc: boolean
  /** Whether a manual range can be set. */
  supportsRange: boolean
  /**
   * Selectable manual ranges in base units, ascending, or null when range is
   * fixed/automatic. Probed from a real SDM3045X (2026-06-12) by stepping
   * `SENS:<fn>:RANG` from below minimum and reading back the clamped value.
   */
  ranges: number[] | null
}

/**
 * Integration times the SDM3045X actually accepts; anything else is silently
 * clamped (e.g. NPLC 100 reads back as 10), verified against the instrument.
 */
export const NPLC_CHOICES = [0.3, 1, 10] as const

/** Low-frequency AC filter (Hz) for ACV/ACI — the slowest passes the lowest freqs. */
export const AC_BANDWIDTHS = [3, 20, 200] as const

/** Frequency/period gate time (aperture), in seconds. Longer = more resolution. */
export const FREQ_APERTURES = [0.01, 0.1, 1] as const

export const FUNCTION_INFO: Record<MeterFunction, FunctionInfo> = {
  'VOLT:DC': {
    id: 'VOLT:DC',
    label: 'DC Voltage',
    short: 'V ⎓',
    unit: 'V',
    conf: 'CONF:VOLT:DC',
    sense: 'VOLT:DC',
    supportsNplc: true,
    supportsRange: true,
    ranges: [0.2, 2, 20, 200, 1000],
  },
  'VOLT:AC': {
    id: 'VOLT:AC',
    label: 'AC Voltage',
    short: 'V ∿',
    unit: 'V',
    conf: 'CONF:VOLT:AC',
    sense: 'VOLT:AC',
    supportsNplc: false,
    supportsRange: true,
    ranges: [0.2, 2, 20, 200, 750],
  },
  'CURR:DC': {
    id: 'CURR:DC',
    label: 'DC Current',
    short: 'A ⎓',
    unit: 'A',
    conf: 'CONF:CURR:DC',
    sense: 'CURR:DC',
    supportsNplc: true,
    supportsRange: true,
    ranges: [0.0002, 0.002, 0.02, 0.2, 2, 10],
  },
  'CURR:AC': {
    id: 'CURR:AC',
    label: 'AC Current',
    short: 'A ∿',
    unit: 'A',
    conf: 'CONF:CURR:AC',
    sense: 'CURR:AC',
    supportsNplc: false,
    supportsRange: true,
    ranges: [0.02, 0.2, 2, 10],
  },
  RES: {
    id: 'RES',
    label: 'Resistance (2W)',
    short: 'Ω 2W',
    unit: 'Ω',
    conf: 'CONF:RES',
    sense: 'RES',
    supportsNplc: true,
    supportsRange: true,
    ranges: [200, 2e3, 20e3, 200e3, 2e6, 10e6, 100e6],
  },
  FRES: {
    id: 'FRES',
    label: 'Resistance (4W)',
    short: 'Ω 4W',
    unit: 'Ω',
    conf: 'CONF:FRES',
    sense: 'FRES',
    supportsNplc: true,
    supportsRange: true,
    ranges: [200, 2e3, 20e3, 200e3, 2e6, 10e6, 100e6],
  },
  CAP: {
    id: 'CAP',
    label: 'Capacitance',
    short: '⊣⊢',
    unit: 'F',
    conf: 'CONF:CAP',
    sense: 'CAP',
    supportsNplc: false,
    supportsRange: true,
    ranges: [2e-9, 20e-9, 200e-9, 2e-6, 20e-6, 200e-6, 10e-3],
  },
  FREQ: {
    id: 'FREQ',
    label: 'Frequency',
    short: 'Hz',
    unit: 'Hz',
    conf: 'CONF:FREQ',
    sense: 'FREQ',
    supportsNplc: false,
    supportsRange: false,
    ranges: null,
  },
  PER: {
    id: 'PER',
    label: 'Period',
    short: '1/f',
    unit: 's',
    conf: 'CONF:PER',
    sense: 'PER',
    supportsNplc: false,
    supportsRange: false,
    ranges: null,
  },
  CONT: {
    id: 'CONT',
    label: 'Continuity',
    short: '◗))',
    unit: 'Ω',
    conf: 'CONF:CONT',
    sense: null,
    supportsNplc: false,
    supportsRange: false,
    ranges: null,
  },
  DIOD: {
    id: 'DIOD',
    label: 'Diode',
    short: '─▶|─',
    unit: 'V',
    conf: 'CONF:DIOD',
    sense: null,
    supportsNplc: false,
    supportsRange: false,
    ranges: null,
  },
  TEMP: {
    id: 'TEMP',
    label: 'Temperature',
    short: '°C',
    unit: '°C',
    conf: 'CONF:TEMP',
    // The SDM3045X rejects SENS:TEMP:NPLC? (-113 Undefined header), so no NPLC here.
    sense: 'TEMP',
    supportsNplc: false,
    supportsRange: false,
    ranges: null,
  },
}

/**
 * Normalize the instrument's `FUNCtion?` reply (e.g. `"VOLT"`, `"VOLT:DC"`, `"FRES"`)
 * into one of our canonical {@link MeterFunction} ids. Returns null when unrecognized.
 */
export function parseFunctionResponse(raw: string): MeterFunction | null {
  const t = raw.replace(/"/g, '').trim().toUpperCase()
  switch (t) {
    case 'VOLT':
    case 'VOLT:DC':
      return 'VOLT:DC'
    case 'VOLT:AC':
      return 'VOLT:AC'
    case 'CURR':
    case 'CURR:DC':
      return 'CURR:DC'
    case 'CURR:AC':
      return 'CURR:AC'
    case 'RES':
      return 'RES'
    case 'FRES':
      return 'FRES'
    case 'CAP':
      return 'CAP'
    case 'FREQ':
      return 'FREQ'
    case 'PER':
      return 'PER'
    case 'CONT':
      return 'CONT'
    case 'DIOD':
      return 'DIOD'
    case 'TEMP':
      return 'TEMP'
    default:
      return null
  }
}

/** SDM overload / open-input sentinel is ~9.9E37; anything past this is "OL". */
export const OVERLOAD_THRESHOLD = 9e37

/**
 * Parse a raw SCPI numeric reply into a value + overload flag.
 * The SDM returns scientific notation, e.g. `+1.89975329E-03`, and `±9.9E37` for overload.
 */
export function parseReadingValue(raw: string): { value: number; overload: boolean } {
  const value = Number.parseFloat(raw.trim())
  if (!Number.isFinite(value) || Math.abs(value) > OVERLOAD_THRESHOLD) {
    return { value: value < 0 ? -Infinity : Infinity, overload: true }
  }
  return { value, overload: false }
}
