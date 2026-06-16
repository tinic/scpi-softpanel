import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type {
  ClientMessage,
  ConsoleEntry,
  MeterFunction,
  MeterState,
  Reading,
  ServerMessage,
} from '@scpi/shared'

const MAX_READINGS = 3600
const MAX_CONSOLE = 300

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export const useMeterStore = defineStore('meter', () => {
  /** WS link to the broker (distinct from instrument connectivity in `state.connected`). */
  const linked = ref(false)
  const state = ref<MeterState | null>(null)
  const readings = shallowRef<Reading[]>([])
  const consoleLog = ref<ConsoleEntry[]>([])

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const lastReading = computed(() => readings.value.at(-1) ?? null)
  const instrumentConnected = computed(() => state.value?.connected ?? false)

  function connect(): void {
    ws = new WebSocket(wsUrl())
    ws.onopen = () => {
      linked.value = true
    }
    ws.onclose = () => {
      linked.value = false
      scheduleReconnect()
    }
    ws.onerror = () => ws?.close()
    ws.onmessage = (ev: MessageEvent) => {
      try {
        handle(JSON.parse(String(ev.data)) as ServerMessage)
      } catch {
        /* ignore malformed frame */
      }
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, 1500)
  }

  function handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'snapshot':
        state.value = msg.state
        readings.value = msg.readings.slice(-MAX_READINGS)
        break
      case 'state':
        state.value = msg.state
        break
      case 'reading':
        pushReading(msg.reading)
        break
      case 'console':
        pushConsole(msg.entry)
        break
      case 'error':
        pushConsole({ ts: Date.now(), direction: 'error', text: msg.message })
        break
    }
  }

  function pushReading(reading: Reading): void {
    const next = readings.value.concat(reading)
    if (next.length > MAX_READINGS) next.splice(0, next.length - MAX_READINGS)
    readings.value = next
  }

  function pushConsole(entry: ConsoleEntry): void {
    consoleLog.value.push(entry)
    if (consoleLog.value.length > MAX_CONSOLE) {
      consoleLog.value.splice(0, consoleLog.value.length - MAX_CONSOLE)
    }
  }

  function send(msg: ClientMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  // -- actions -------------------------------------------------------------
  const setFunction = (fn: MeterFunction) => send({ type: 'setFunction', function: fn })
  const setRange = (range: string) => send({ type: 'setRange', range })
  const setAutoRange = (enabled: boolean) => send({ type: 'setAutoRange', enabled })
  const setNplc = (nplc: number) => send({ type: 'setNplc', nplc })
  const setContThreshold = (ohms: number) => send({ type: 'setContThreshold', ohms })
  const setPolling = (enabled: boolean) => send({ type: 'setPolling', enabled })
  const setInterval = (intervalMs: number) => send({ type: 'setInterval', intervalMs })
  const measureOnce = () => send({ type: 'measureOnce' })
  const refresh = () => send({ type: 'refresh' })
  const raw = (cmd: string, expectReply: boolean) => send({ type: 'raw', cmd, expectReply })
  const clearConsole = () => {
    consoleLog.value = []
  }

  // -- meter target (settings), over REST since it changes the connection itself --
  async function getConfig(): Promise<{ meterHost: string; meterPort: number }> {
    return (await fetch('/api/config')).json()
  }
  async function saveConfig(meterHost: string, meterPort: number): Promise<void> {
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meterHost, meterPort }),
    })
  }

  return {
    linked,
    state,
    readings,
    consoleLog,
    lastReading,
    instrumentConnected,
    connect,
    setFunction,
    setRange,
    setAutoRange,
    setNplc,
    setContThreshold,
    setPolling,
    setInterval,
    measureOnce,
    refresh,
    raw,
    clearConsole,
    getConfig,
    saveConfig,
  }
})
