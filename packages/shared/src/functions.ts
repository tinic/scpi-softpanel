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
}

export const FUNCTION_INFO: Record<MeterFunction, FunctionInfo> = {
  'VOLT:DC': {
    id: 'VOLT:DC',
    label: 'DC Voltage',
    unit: 'V',
    conf: 'CONF:VOLT:DC',
    sense: 'VOLT:DC',
    supportsNplc: true,
    supportsRange: true,
  },
  'VOLT:AC': {
    id: 'VOLT:AC',
    label: 'AC Voltage',
    unit: 'V',
    conf: 'CONF:VOLT:AC',
    sense: 'VOLT:AC',
    supportsNplc: false,
    supportsRange: true,
  },
  'CURR:DC': {
    id: 'CURR:DC',
    label: 'DC Current',
    unit: 'A',
    conf: 'CONF:CURR:DC',
    sense: 'CURR:DC',
    supportsNplc: true,
    supportsRange: true,
  },
  'CURR:AC': {
    id: 'CURR:AC',
    label: 'AC Current',
    unit: 'A',
    conf: 'CONF:CURR:AC',
    sense: 'CURR:AC',
    supportsNplc: false,
    supportsRange: true,
  },
  RES: {
    id: 'RES',
    label: 'Resistance (2W)',
    unit: 'Ω',
    conf: 'CONF:RES',
    sense: 'RES',
    supportsNplc: true,
    supportsRange: true,
  },
  FRES: {
    id: 'FRES',
    label: 'Resistance (4W)',
    unit: 'Ω',
    conf: 'CONF:FRES',
    sense: 'FRES',
    supportsNplc: true,
    supportsRange: true,
  },
  CAP: {
    id: 'CAP',
    label: 'Capacitance',
    unit: 'F',
    conf: 'CONF:CAP',
    sense: 'CAP',
    supportsNplc: false,
    supportsRange: true,
  },
  FREQ: {
    id: 'FREQ',
    label: 'Frequency',
    unit: 'Hz',
    conf: 'CONF:FREQ',
    sense: 'FREQ',
    supportsNplc: false,
    supportsRange: false,
  },
  PER: {
    id: 'PER',
    label: 'Period',
    unit: 's',
    conf: 'CONF:PER',
    sense: 'PER',
    supportsNplc: false,
    supportsRange: false,
  },
  CONT: {
    id: 'CONT',
    label: 'Continuity',
    unit: 'Ω',
    conf: 'CONF:CONT',
    sense: null,
    supportsNplc: false,
    supportsRange: false,
  },
  DIOD: {
    id: 'DIOD',
    label: 'Diode',
    unit: 'V',
    conf: 'CONF:DIOD',
    sense: null,
    supportsNplc: false,
    supportsRange: false,
  },
  TEMP: {
    id: 'TEMP',
    label: 'Temperature',
    unit: '°C',
    conf: 'CONF:TEMP',
    sense: 'TEMP',
    supportsNplc: true,
    supportsRange: false,
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
