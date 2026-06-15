import net from 'node:net'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Meter } from './Meter.js'
import type { BridgeClient } from '../bridge/BridgeClient.js'

/**
 * The reconnect path must never open the (single-session) VISA link while the
 * meter is off or booting — opening VXI-11/RPC mid-boot can wedge the instrument.
 * We simulate "off" (no listener on the probe port) vs. "on" (listener up) with a
 * local TCP server and assert the bridge.connect gate.
 */

function fakeBridge() {
  const ee = new EventEmitter() as EventEmitter & Partial<BridgeClient>
  ee.connect = vi.fn(async (resource: string) => ({ idn: 'FAKE,SDM,0,1', resource }))
  ee.query = vi.fn(async () => '1') // refreshConfig: any benign reply
  ee.write = vi.fn(async () => undefined)
  return ee as unknown as BridgeClient & {
    connect: ReturnType<typeof vi.fn>
    emit: EventEmitter['emit']
  }
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, 15))
  }
  return pred()
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

let meter: Meter | null = null
let server: net.Server | null = null

afterEach(async () => {
  meter?.stop()
  meter = null
  if (server) await new Promise<void>((r) => server!.close(() => r()))
  server = null
})

describe('Meter reconnect gating', () => {
  it('does not open the VISA link while the meter is unreachable', async () => {
    const port = await freePort() // nothing listening => "meter off"
    const bridge = fakeBridge()
    meter = new Meter(bridge, {
      resource: 'TCPIP::127.0.0.1::INSTR',
      timeoutMs: 1000,
      intervalMs: 100,
      probePort: port,
      probeTimeoutMs: 100,
      bootSettleMs: 50,
      reconnectDelayMs: 30,
    })

    bridge.emit('ready') // kick the first probe-gated attempt
    // Give several reconnect cycles a chance to (wrongly) connect.
    await new Promise((r) => setTimeout(r, 300))
    expect(bridge.connect).not.toHaveBeenCalled()
  })

  it('connects after the meter becomes reachable and the boot-settle elapses', async () => {
    const port = await freePort()
    const bridge = fakeBridge()
    meter = new Meter(bridge, {
      resource: 'TCPIP::127.0.0.1::INSTR',
      timeoutMs: 1000,
      intervalMs: 100,
      probePort: port,
      probeTimeoutMs: 100,
      bootSettleMs: 50,
      reconnectDelayMs: 30,
    })

    bridge.emit('ready')
    await new Promise((r) => setTimeout(r, 150)) // confirm it's holding off
    expect(bridge.connect).not.toHaveBeenCalled()

    // "power on" the meter: start listening on the probe port.
    server = net.createServer((s) => s.end())
    await new Promise<void>((r) => server!.listen(port, '127.0.0.1', () => r()))

    expect(await waitFor(() => bridge.connect.mock.calls.length > 0)).toBe(true)
    expect(meter.state.connected).toBe(true)
  })
})
