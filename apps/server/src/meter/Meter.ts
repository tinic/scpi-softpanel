import { EventEmitter } from 'node:events'
import net from 'node:net'
import {
  FUNCTION_INFO,
  parseFunctionResponse,
  parseReadingValue,
  type ConsoleEntry,
  type MeterFunction,
  type MeterState,
  type Reading,
} from '@scpi/shared'
import type { BridgeClient } from '../bridge/BridgeClient.js'

export interface MeterOptions {
  resource: string
  timeoutMs: number
  intervalMs: number
  reconnectDelayMs?: number
  /** TCP port probed for reachability before opening the (single-session) VISA link. */
  probePort?: number
  /** Timeout for the reachability probe. */
  probeTimeoutMs?: number
  /**
   * Grace period after the meter first becomes reachable before opening the link.
   * The SDM allows one control session and brings its VXI-11/RPC services up
   * mid-boot; opening the session too early can wedge its startup, so we wait.
   */
  bootSettleMs?: number
}

/**
 * High-level instrument controller. Translates intent (set function, set NPLC,
 * measure) into SCPI, owns the canonical {@link MeterState}, and manages the
 * session lifecycle on top of the {@link BridgeClient}. Emits `state` on any change
 * and `console` for human-visible command traffic (control + raw, not poll reads).
 */
export class Meter extends EventEmitter {
  readonly state: MeterState
  private connecting = false
  private stopped = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private readonly reconnectDelayMs: number
  private readonly probeHost: string | null
  private readonly probePort: number
  private readonly probeTimeoutMs: number
  private readonly bootSettleMs: number
  // Start optimistic: a meter already up when the broker launches connects without
  // waiting out the settle delay; only a true off→on transition triggers the grace.
  private wasReachable = true

  constructor(
    private readonly bridge: BridgeClient,
    private readonly opts: MeterOptions,
  ) {
    super()
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 3000
    this.probePort = opts.probePort ?? 5025
    this.probeTimeoutMs = opts.probeTimeoutMs ?? 1500
    this.bootSettleMs = opts.bootSettleMs ?? 8000
    this.probeHost = parseTcpipHost(opts.resource)
    this.state = {
      connected: false,
      idn: null,
      resource: opts.resource,
      function: null,
      range: null,
      autoRange: null,
      nplc: null,
      contThreshold: null,
      polling: false,
      intervalMs: opts.intervalMs,
      lastError: null,
    }

    // The bridge re-emits `ready` on first launch and after any respawn; both mean
    // "no live session" so we (re)attempt a connection uniformly (probe-gated).
    this.bridge.on('ready', () => void this.tick())
    this.bridge.on('event', (e: { event?: string; reason?: string }) => {
      if (e.event === 'disconnected') {
        this.patch({ connected: false })
        this.console('error', `instrument link lost${e.reason ? ` (${e.reason})` : ''}`)
        this.scheduleReconnect()
      }
    })
    this.bridge.on('down', () => {
      this.patch({ connected: false })
      this.console('error', 'bridge process exited; restarting')
    })
  }

  // -- lifecycle -----------------------------------------------------------

  async connect(): Promise<void> {
    if (this.connecting) return
    this.connecting = true
    try {
      this.console('info', `connecting ${this.opts.resource}`)
      const { idn } = await this.bridge.connect(this.opts.resource, this.opts.timeoutMs)
      this.patch({ connected: true, idn, resource: this.opts.resource, lastError: null })
      this.console('info', `connected: ${idn}`)
      await this.refreshConfig()
    } catch (err) {
      const message = errMessage(err)
      this.patch({ connected: false, lastError: message })
      this.console('error', `connect failed: ${message}`)
      this.scheduleReconnect()
    } finally {
      this.connecting = false
    }
  }

  /** Halt reconnect attempts and release timers (graceful shutdown / tests). */
  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect(delayMs = this.reconnectDelayMs): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.tick()
    }, delayMs)
  }

  /**
   * Reconnect driver. Probes a cheap TCP port first and only opens the heavy,
   * single-session VISA link when the instrument is reachable AND was already
   * reachable on the previous attempt. A fresh off→on transition (the meter was
   * just powered on) instead gets a boot-settle grace period — hammering
   * VXI-11/RPC at a meter mid-boot can wedge its startup. A bare TCP probe is far
   * gentler than a VXI-11 link negotiation, and we emit none of the latter while
   * the meter is off or booting.
   */
  private async tick(): Promise<void> {
    if (this.stopped || this.connecting || this.state.connected) return

    // Unparseable / non-TCPIP resource (e.g. a simulator): keep the old behavior.
    if (this.probeHost === null) {
      await this.connect()
      return
    }

    const reachable = await probeTcp(this.probeHost, this.probePort, this.probeTimeoutMs)
    if (!reachable) {
      this.wasReachable = false
      this.scheduleReconnect()
      return
    }
    if (!this.wasReachable) {
      // Just came up — let it finish booting before we claim its single session.
      this.wasReachable = true
      this.console(
        'info',
        `instrument reachable; waiting ${this.bootSettleMs}ms for boot to settle`,
      )
      this.scheduleReconnect(this.bootSettleMs)
      return
    }
    await this.connect()
  }

  // -- measurement ---------------------------------------------------------

  /** Single sample using the current configuration. Does not log to the console. */
  async measure(): Promise<Reading> {
    const raw = await this.bridge.query('READ?')
    const { value, overload } = parseReadingValue(raw)
    const fn = this.state.function
    const unit = fn ? FUNCTION_INFO[fn].unit : ''
    return {
      ts: Date.now(),
      value,
      unit,
      function: fn ?? 'UNKNOWN',
      overload,
      raw,
    }
  }

  // -- control -------------------------------------------------------------

  async setFunction(fn: MeterFunction): Promise<void> {
    await this.command(FUNCTION_INFO[fn].conf)
    this.patch({ function: fn })
    await this.refreshConfig()
  }

  async setNplc(nplc: number): Promise<void> {
    const info = this.currentInfo()
    if (!info?.sense || !info.supportsNplc) {
      throw new Error(`NPLC not applicable for ${this.state.function ?? 'unknown function'}`)
    }
    await this.command(`SENS:${info.sense}:NPLC ${nplc}`)
    // Read back: the instrument clamps out-of-range values (e.g. 100 -> 10).
    const actual = await this.queryNum(`SENS:${info.sense}:NPLC?`)
    this.patch({ nplc: actual ?? nplc })
  }

  async setRange(range: string): Promise<void> {
    const info = this.currentInfo()
    if (!info?.sense || !info.supportsRange) {
      throw new Error(`range not settable for ${this.state.function ?? 'unknown function'}`)
    }
    if (range.toUpperCase() === 'AUTO') {
      await this.command(`SENS:${info.sense}:RANG:AUTO ON`)
      this.patch({ autoRange: true, range: 'AUTO' })
    } else {
      await this.command(`SENS:${info.sense}:RANG ${range}`)
      // Read back the range the instrument actually selected (it clamps).
      const actual = await this.queryNum(`SENS:${info.sense}:RANG?`)
      this.patch({ autoRange: false, range: actual != null ? String(actual) : range })
    }
  }

  async setAutoRange(enabled: boolean): Promise<void> {
    const info = this.currentInfo()
    if (!info?.sense || !info.supportsRange) {
      throw new Error(`autorange not settable for ${this.state.function ?? 'unknown function'}`)
    }
    await this.command(`SENS:${info.sense}:RANG:AUTO ${enabled ? 'ON' : 'OFF'}`)
    this.patch({ autoRange: enabled })
    if (enabled) {
      this.patch({ range: 'AUTO' })
    } else {
      const r = await this.queryNum(`SENS:${info.sense}:RANG?`)
      this.patch({ range: r != null ? String(r) : null })
    }
  }

  /** Set the continuity beep threshold (0–2000 Ω). CONT mode only. */
  async setContThreshold(ohms: number): Promise<void> {
    if (this.state.function !== 'CONT') {
      throw new Error('continuity threshold is only settable in CONT mode')
    }
    await this.command(`CONT:THR:VAL ${ohms}`)
    const actual = await this.queryNum('CONT:THR:VAL?')
    this.patch({ contThreshold: actual ?? ohms })
  }

  setInterval(intervalMs: number): void {
    this.patch({ intervalMs })
  }

  setPolling(polling: boolean): void {
    this.patch({ polling })
  }

  /** Raw SCPI passthrough for the console. Returns the reply when `expectReply`. */
  async raw(cmd: string, expectReply: boolean): Promise<string | null> {
    this.console('tx', cmd)
    if (expectReply) {
      const reply = await this.bridge.query(cmd)
      this.console('rx', reply)
      return reply
    }
    await this.bridge.write(cmd)
    // A bare write may have changed function/range/NPLC; re-read so the panel
    // stays truthful without a manual refresh control.
    await this.refreshConfig()
    return null
  }

  // -- state read-back -----------------------------------------------------

  /** Best-effort re-read of function/range/autorange/NPLC from the instrument. */
  async refreshConfig(): Promise<void> {
    if (!this.state.connected) return
    try {
      const fn = parseFunctionResponse(await this.bridge.query('FUNC?'))
      const patch: Partial<MeterState> = { function: fn }
      if (fn) {
        const info = FUNCTION_INFO[fn]
        if (info.sense && info.supportsRange) {
          const auto = await this.queryBool(`SENS:${info.sense}:RANG:AUTO?`)
          patch.autoRange = auto
          const r = await this.queryNum(`SENS:${info.sense}:RANG?`)
          patch.range = auto ? 'AUTO' : r != null ? String(r) : null
        } else {
          patch.autoRange = null
          patch.range = null
        }
        patch.nplc =
          info.sense && info.supportsNplc ? await this.queryNum(`SENS:${info.sense}:NPLC?`) : null
        // The instrument resets this to its 50 Ω default on every CONFigure.
        patch.contThreshold = fn === 'CONT' ? await this.queryNum('CONT:THR:VAL?') : null
      }
      this.patch(patch)
    } catch (err) {
      this.console('error', `config read-back failed: ${errMessage(err)}`)
    }
  }

  // -- helpers -------------------------------------------------------------

  private currentInfo() {
    return this.state.function ? FUNCTION_INFO[this.state.function] : null
  }

  private async command(cmd: string): Promise<void> {
    this.console('tx', cmd)
    await this.bridge.write(cmd)
  }

  private async queryNum(cmd: string): Promise<number | null> {
    try {
      const n = Number.parseFloat((await this.bridge.query(cmd)).trim())
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }

  private async queryBool(cmd: string): Promise<boolean | null> {
    try {
      const t = (await this.bridge.query(cmd)).trim().toUpperCase()
      return t === '1' || t === 'ON'
    } catch {
      return null
    }
  }

  private patch(partial: Partial<MeterState>): void {
    Object.assign(this.state, partial)
    this.emit('state', this.state)
  }

  private console(direction: ConsoleEntry['direction'], text: string): void {
    const entry: ConsoleEntry = { ts: Date.now(), direction, text }
    this.emit('console', entry)
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Extract the host from a TCPIP VISA resource, or null for non-TCPIP forms.
 *   TCPIP::192.168.1.166::INSTR          -> 192.168.1.166
 *   TCPIP0::192.168.1.166::5025::SOCKET  -> 192.168.1.166
 */
function parseTcpipHost(resource: string): string | null {
  const parts = resource.split('::')
  return parts.length >= 2 && /^TCPIP\d*$/i.test(parts[0]) ? parts[1] : null
}

/** Resolve true iff a TCP connection to host:port completes within timeoutMs. */
function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}
