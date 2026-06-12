import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { EventEmitter } from 'node:events'

export interface BridgeClientOptions {
  python: string
  script: string
  defaultTimeoutMs: number
  /** Backoff between child respawns after an unexpected exit. */
  restartDelayMs?: number
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Owns the Python bridge child process and exposes a serialized request/response
 * API over its stdio JSON-RPC. The instrument allows a single control session, so
 * every call is funneled through one in-flight slot (see {@link call}). The child
 * is supervised: an unexpected exit rejects in-flight work and respawns with backoff,
 * re-emitting `ready` so the meter layer can re-establish its session.
 *
 * Events: `ready`, `event` (raw bridge events), `down` (child exited), `log` (stderr).
 */
export class BridgeClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private rl: Interface | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private tail: Promise<unknown> = Promise.resolve()
  private stopped = false
  private readonly restartDelayMs: number

  constructor(private readonly opts: BridgeClientOptions) {
    super()
    this.restartDelayMs = opts.restartDelayMs ?? 2000
  }

  start(): void {
    this.stopped = false
    this.spawnChild()
  }

  stop(): void {
    this.stopped = true
    this.rejectAll(new Error('bridge stopped'))
    this.proc?.kill('SIGTERM')
    this.proc = null
  }

  private spawnChild(): void {
    const proc = spawn(this.opts.python, [this.opts.script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.proc = proc

    this.rl = createInterface({ input: proc.stdout })
    this.rl.on('line', (line) => this.onLine(line))

    const errLines = createInterface({ input: proc.stderr })
    errLines.on('line', (line) => this.emit('log', line))

    proc.on('exit', (code, signal) => {
      this.rejectAll(new Error(`bridge exited (code=${code} signal=${signal})`))
      this.emit('down', { code, signal })
      this.rl?.close()
      this.rl = null
      this.proc = null
      if (!this.stopped) {
        setTimeout(() => {
          if (!this.stopped) this.spawnChild()
        }, this.restartDelayMs)
      }
    })

    proc.on('error', (err) => this.emit('log', `spawn error: ${err.message}`))
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      this.emit('log', `non-JSON from bridge: ${line}`)
      return
    }

    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      clearTimeout(pending.timer)
      if (msg.ok) {
        pending.resolve(msg.result)
      } else {
        const err = new Error(String(msg.error ?? 'bridge error'))
        ;(err as Error & { code?: string }).code = msg.code as string | undefined
        pending.reject(err)
      }
      return
    }

    if (typeof msg.event === 'string') {
      if (msg.event === 'ready') this.emit('ready', msg)
      this.emit('event', msg)
    }
  }

  /**
   * Serialized RPC: each call waits for the previous one to settle before being
   * written, guaranteeing a single outstanding request to the single-session meter.
   */
  call(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    const run = () => this.rawCall(method, params, timeoutMs)
    const result = this.tail.then(run, run)
    this.tail = result.catch(() => undefined)
    return result
  }

  private rawCall(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const proc = this.proc
      if (!proc || proc.stdin.destroyed) {
        reject(new Error('bridge not running'))
        return
      }
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new Error(`bridge timeout on ${method} (${timeoutMs ?? this.opts.defaultTimeoutMs}ms)`),
        )
      }, timeoutMs ?? this.opts.defaultTimeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      proc.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  private rejectAll(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }

  // -- typed conveniences --------------------------------------------------

  async connect(resource: string, timeoutMs: number): Promise<{ idn: string; resource: string }> {
    const r = (await this.call(
      'connect',
      { resource, timeout_ms: timeoutMs },
      timeoutMs + 2000,
    )) as {
      idn: string
      resource: string
    }
    return r
  }

  async query(cmd: string): Promise<string> {
    return (await this.call('query', { cmd })) as string
  }

  async write(cmd: string): Promise<void> {
    await this.call('write', { cmd })
  }
}
