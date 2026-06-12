import { describe, expect, it } from 'vitest'
import { RingReadingStore } from './ReadingStore.js'
import type { Reading } from '@scpi/shared'

const mk = (value: number): Reading => ({
  ts: value,
  value,
  unit: 'V',
  function: 'VOLT:DC',
  overload: false,
})

describe('RingReadingStore', () => {
  it('keeps insertion order until full', () => {
    const s = new RingReadingStore(5)
    ;[1, 2, 3].forEach((v) => s.push(mk(v)))
    expect(s.all().map((r) => r.value)).toEqual([1, 2, 3])
    expect(s.size).toBe(3)
  })

  it('overwrites oldest once capacity is exceeded', () => {
    const s = new RingReadingStore(3)
    ;[1, 2, 3, 4, 5].forEach((v) => s.push(mk(v)))
    expect(s.all().map((r) => r.value)).toEqual([3, 4, 5])
    expect(s.size).toBe(3)
  })

  it('recent(n) returns the last n', () => {
    const s = new RingReadingStore(10)
    ;[1, 2, 3, 4].forEach((v) => s.push(mk(v)))
    expect(s.recent(2).map((r) => r.value)).toEqual([3, 4])
  })
})
