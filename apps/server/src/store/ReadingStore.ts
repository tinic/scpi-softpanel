import type { Reading } from '@scpi/shared'

/**
 * Storage abstraction for the trend history. The vertical slice ships an in-memory
 * ring buffer; a SQLite-backed implementation can drop in behind this interface
 * later without touching the broker, WS layer, or UI.
 */
export interface ReadingStore {
  push(reading: Reading): void
  /** Most recent `n` readings (oldest-first), or all when `n` is omitted. */
  recent(n?: number): Reading[]
  all(): Reading[]
  clear(): void
  readonly size: number
  readonly capacity: number
}

/** Fixed-capacity ring buffer. O(1) push, oldest entries overwritten. */
export class RingReadingStore implements ReadingStore {
  private buf: Reading[]
  private head = 0 // index of the next write
  private count = 0

  constructor(public readonly capacity: number) {
    if (capacity <= 0) throw new Error('capacity must be positive')
    this.buf = new Array<Reading>(capacity)
  }

  get size(): number {
    return this.count
  }

  push(reading: Reading): void {
    this.buf[this.head] = reading
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  all(): Reading[] {
    const out: Reading[] = []
    const start = (this.head - this.count + this.capacity) % this.capacity
    for (let i = 0; i < this.count; i++) {
      out.push(this.buf[(start + i) % this.capacity])
    }
    return out
  }

  recent(n?: number): Reading[] {
    const all = this.all()
    if (n === undefined || n >= all.length) return all
    return all.slice(all.length - n)
  }

  clear(): void {
    this.head = 0
    this.count = 0
  }
}
