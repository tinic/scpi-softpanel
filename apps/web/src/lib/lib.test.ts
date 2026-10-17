import { describe, expect, it } from 'vitest'
import { axisScale, formatValue, parseEng, stepDecimals } from './format'
import { countFloor, isStable, summarize } from './stats'
import { applyMath, DEFAULT_MATH, mathApplies } from './math'
import { evaluate, fromTolerance } from './limits'

describe('axisScale', () => {
  it('picks one prefix for the axis from its largest magnitude', () => {
    expect(axisScale(0.0038, 'V')).toEqual({ div: 1e-3, unit: 'mV' })
    expect(axisScale(4698, 'Ω')).toEqual({ div: 1e3, unit: 'kΩ' })
    expect(axisScale(0, 'V')).toEqual({ div: 1, unit: 'V' })
  })
  it('agrees with the readout formatter', () => {
    expect(formatValue(0.0029827, 'V').unit).toBe(axisScale(0.0029827, 'V').unit)
  })
})

describe('parseEng', () => {
  it('reads plain numbers and SI prefixes', () => {
    expect(parseEng('3.3')).toBe(3.3)
    expect(parseEng('-1e-3')).toBe(-0.001)
    expect(parseEng('2.95m')).toBeCloseTo(0.00295)
    expect(parseEng('10 µ')).toBeCloseTo(1e-5)
    expect(parseEng('10u')).toBeCloseTo(1e-5)
    expect(parseEng('4k7')).toBeCloseTo(4700)
    expect(parseEng('1,5')).toBe(1.5)
  })
  it('strips a known unit', () => {
    expect(parseEng('2.95 mV', ['V'])).toBeCloseTo(0.00295)
    expect(parseEng('2.95 mVDC', ['V', 'VDC'])).toBeCloseTo(0.00295)
    expect(parseEng('3 psi', ['psi'])).toBe(3)
  })
  it('rejects junk and unknown suffixes', () => {
    expect(parseEng('')).toBeNull()
    expect(parseEng('abc')).toBeNull()
    expect(parseEng('3 psi')).toBeNull()
    expect(parseEng('1.2.3')).toBeNull()
  })
})

describe('summarize', () => {
  it('computes mean, sample sigma and extremes, skipping overload', () => {
    const s = summarize([1, 2, 3, 4, Infinity])!
    expect(s.n).toBe(4)
    expect(s.mean).toBeCloseTo(2.5)
    expect(s.std).toBeCloseTo(1.290994)
    expect(s.pp).toBe(3)
  })
  it('is null with no finite values', () => {
    expect(summarize([Infinity])).toBeNull()
  })
})

describe('isStable', () => {
  it('needs enough readings', () => {
    expect(isStable([1, 1, 1], 0.001)).toBe(false)
  })
  it('accepts a settled reading and rejects a drifting one', () => {
    expect(
      isStable(
        Array(8)
          .fill(5)
          .map((v, i) => v + i * 1e-5),
        0.001,
      ),
    ).toBe(true)
    expect(
      isStable(
        Array(8)
          .fill(5)
          .map((v, i) => v + i * 0.01),
        0.001,
      ),
    ).toBe(false)
  })
  it('uses a display-count floor near zero', () => {
    expect(countFloor(0.0012)).toBeCloseTo(5e-7)
    expect(isStable([1e-6, 2e-6, 1e-6, 0, 1e-6, 2e-6, 1e-6, 1e-6], 0.001)).toBe(false)
    expect(isStable([1e-3, 1.0001e-3, 1e-3, 1e-3, 1e-3, 1e-3, 1e-3, 1e-3], 0)).toBe(true)
  })
  it('is never stable across an overload', () => {
    expect(isStable([...Array(7).fill(1), Infinity], 0.01)).toBe(false)
  })
})

describe('math', () => {
  it('applies mX+b', () => {
    expect(applyMath(0.1, { ...DEFAULT_MATH, mode: 'mxb', m: 10, b: 1 })).toBeCloseTo(2)
  })
  it('computes dBm into 600 Ω (0.7746 V ≈ 0 dBm)', () => {
    expect(applyMath(0.7746, { ...DEFAULT_MATH, mode: 'dbm', refOhm: 600 })).toBeCloseTo(0, 2)
  })
  it('computes dB against a reference voltage', () => {
    expect(applyMath(0.1, { ...DEFAULT_MATH, mode: 'db', refV: 1 })).toBeCloseTo(-20)
  })
  it('computes percent deviation', () => {
    expect(applyMath(1010, { ...DEFAULT_MATH, mode: 'pct', nominal: 1000 })).toBeCloseTo(1)
  })
  it('passes overload through', () => {
    expect(applyMath(Infinity, { ...DEFAULT_MATH, mode: 'mxb', m: 2 })).toBe(Infinity)
  })
  it('limits dB modes to voltage', () => {
    expect(mathApplies('dbm', 'VOLT:AC')).toBe(true)
    expect(mathApplies('dbm', 'RES')).toBe(false)
    expect(mathApplies('mxb', 'CONT')).toBe(false)
  })
})

describe('limits', () => {
  const lim = { enabled: true, lo: 1, hi: 2 }
  it('classifies pass / lo / hi', () => {
    expect(evaluate(1.5, lim)).toBe('pass')
    expect(evaluate(0.5, lim)).toBe('lo')
    expect(evaluate(2.5, lim)).toBe('hi')
  })
  it('supports one-sided limits and fails overload', () => {
    expect(evaluate(100, { enabled: true, lo: 1, hi: null })).toBe('pass')
    expect(evaluate(Infinity, { enabled: true, lo: 1, hi: null })).toBe('hi')
  })
  it('is inert when disabled or unset', () => {
    expect(evaluate(5, { ...lim, enabled: false })).toBeNull()
    expect(evaluate(5, { enabled: true, lo: null, hi: null })).toBeNull()
  })
  it('derives limits from a tolerance', () => {
    const { lo, hi } = fromTolerance(1000, 5)
    expect(lo).toBeCloseTo(950)
    expect(hi).toBeCloseTo(1050)
  })
})

describe('stepDecimals', () => {
  it('prints every tick of the step exactly', () => {
    expect(stepDecimals(0.025)).toBe(3)
    expect(stepDecimals(0.5)).toBe(1)
    expect(stepDecimals(20)).toBe(0)
    expect(stepDecimals(0.0002)).toBe(4)
  })
})
