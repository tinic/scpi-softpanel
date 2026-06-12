import { describe, expect, it } from 'vitest'
import { parseFunctionResponse, parseReadingValue, FUNCTION_INFO } from './functions.js'

describe('parseFunctionResponse', () => {
  it('maps bare VOLT to DC voltage', () => {
    expect(parseFunctionResponse('"VOLT"')).toBe('VOLT:DC')
  })
  it('handles quoted, explicit functions', () => {
    expect(parseFunctionResponse('"FRES"')).toBe('FRES')
    expect(parseFunctionResponse('VOLT:AC')).toBe('VOLT:AC')
  })
  it('returns null for unknown', () => {
    expect(parseFunctionResponse('"BOGUS"')).toBeNull()
  })
})

describe('parseReadingValue', () => {
  it('parses scientific notation', () => {
    expect(parseReadingValue('+1.89975329E-03').value).toBeCloseTo(0.00189975329)
  })
  it('flags overload sentinel', () => {
    const r = parseReadingValue('+9.90000000E+37')
    expect(r.overload).toBe(true)
    expect(r.value).toBe(Infinity)
  })
})

describe('FUNCTION_INFO', () => {
  it('has an entry per function with a CONF command', () => {
    for (const info of Object.values(FUNCTION_INFO)) {
      expect(info.conf.startsWith('CONF')).toBe(true)
    }
  })
  it('has a short front-panel label everywhere', () => {
    for (const info of Object.values(FUNCTION_INFO)) {
      expect(info.short.length).toBeGreaterThan(0)
      expect(info.short.length).toBeLessThanOrEqual(5)
    }
  })
  it('lists ascending ranges exactly when a manual range is settable', () => {
    for (const info of Object.values(FUNCTION_INFO)) {
      if (info.supportsRange) {
        expect(info.ranges).not.toBeNull()
        expect(info.ranges!.length).toBeGreaterThan(1)
        for (let i = 1; i < info.ranges!.length; i++) {
          expect(info.ranges![i]).toBeGreaterThan(info.ranges![i - 1])
        }
      } else {
        expect(info.ranges).toBeNull()
      }
    }
  })
})
