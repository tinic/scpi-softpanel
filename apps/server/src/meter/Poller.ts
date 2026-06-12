import type { Reading } from '@scpi/shared'
import type { Meter } from './Meter.js'
import type { ReadingStore } from '../store/ReadingStore.js'

/**
 * Drives periodic measurement. Uses a self-rescheduling timeout (not setInterval)
 * so a slow read at high NPLC can never pile up overlapping requests on the
 * single-session meter — the next poll is scheduled only after the previous settles.
 */
export class Poller {
  private running = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly meter: Meter,
    private readonly store: ReadingStore,
    private readonly onReading: (reading: Reading) => void,
    private readonly onError: (message: string) => void,
  ) {}

  get isRunning(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule(0)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    try {
      if (this.meter.state.connected) {
        const reading = await this.meter.measure()
        this.store.push(reading)
        this.onReading(reading)
      }
    } catch (err) {
      this.onError(err instanceof Error ? err.message : String(err))
    } finally {
      if (this.running) this.schedule(Math.max(10, this.meter.state.intervalMs))
    }
  }
}
