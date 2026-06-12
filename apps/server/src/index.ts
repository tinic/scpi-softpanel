import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import type { ClientMessage, ServerMessage } from '@scpi/shared'
import { config } from './config.js'
import { BridgeClient } from './bridge/BridgeClient.js'
import { Meter } from './meter/Meter.js'
import { Poller } from './meter/Poller.js'
import { RingReadingStore } from './store/ReadingStore.js'
import { WsHub } from './ws/hub.js'

async function main(): Promise<void> {
  const store = new RingReadingStore(config.ringCapacity)

  const bridge = new BridgeClient({
    python: config.bridgePython,
    script: config.bridgeScript,
    defaultTimeoutMs: config.meterTimeoutMs,
  })
  bridge.on('log', (line: string) => console.error('[bridge]', line))

  const meter = new Meter(bridge, {
    resource: config.meterResource,
    timeoutMs: config.meterTimeoutMs,
    intervalMs: config.pollIntervalMs,
  })

  function snapshot(): ServerMessage {
    return { type: 'snapshot', state: meter.state, readings: store.recent() }
  }

  const hub = new WsHub(
    snapshot,
    (msg) => handleClient(msg),
    (message) => hub.broadcast({ type: 'error', message }),
  )

  const poller = new Poller(
    meter,
    store,
    (reading) => hub.broadcast({ type: 'reading', reading }),
    (message) =>
      hub.broadcast({
        type: 'console',
        entry: { ts: Date.now(), direction: 'error', text: `poll: ${message}` },
      }),
  )

  // `state.polling` is the desired state (seeded from config at startup, then owned
  // by the user). Reconcile the poller against it here: polling resumes across
  // reconnects, but a user Stop stays stopped instead of being instantly
  // re-triggered by its own state broadcast.
  meter.on('state', (state) => {
    hub.broadcast({ type: 'state', state })
    if (state.connected && state.polling && !poller.isRunning) {
      poller.start()
    }
  })
  meter.on('console', (entry) => hub.broadcast({ type: 'console', entry }))

  async function handleClient(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'setFunction':
        await meter.setFunction(msg.function)
        break
      case 'setRange':
        await meter.setRange(msg.range)
        break
      case 'setAutoRange':
        await meter.setAutoRange(msg.enabled)
        break
      case 'setNplc':
        await meter.setNplc(msg.nplc)
        break
      case 'setInterval':
        meter.setInterval(msg.intervalMs)
        break
      case 'setPolling':
        if (!msg.enabled) poller.stop()
        meter.setPolling(msg.enabled) // start happens via the state reconciler
        break
      case 'measureOnce': {
        const reading = await meter.measure()
        store.push(reading)
        hub.broadcast({ type: 'reading', reading })
        break
      }
      case 'refresh':
        await meter.refreshConfig()
        break
      case 'raw':
        await meter.raw(msg.cmd, msg.expectReply)
        break
    }
  }

  // -- HTTP / WS server ----------------------------------------------------

  const app = Fastify({ logger: false })

  await app.register(fastifyWebsocket)
  app.get('/ws', { websocket: true }, (socket) => {
    hub.add(socket)
  })

  app.get('/api/health', () => ({
    ok: true,
    connected: meter.state.connected,
    clients: hub.clientCount,
  }))
  app.get('/api/state', () => meter.state)
  app.get<{ Querystring: { n?: string } }>('/api/readings', (req) => {
    const n = req.query.n ? Number.parseInt(req.query.n, 10) : undefined
    return store.recent(Number.isFinite(n) ? n : undefined)
  })

  const hasWeb = existsSync(config.webDist)
  if (hasWeb) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/' })
    // SPA fallback for client-side routes.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ error: 'not found' })
    })
  } else {
    app.get('/', () => ({
      service: 'scpi-softpanel server',
      note: 'web UI not built; run `pnpm --filter @scpi/web dev` or `pnpm build`',
      endpoints: ['/api/health', '/api/state', '/api/readings', '/ws'],
    }))
  }

  // -- start ---------------------------------------------------------------

  meter.setPolling(config.pollAutostart)
  bridge.start()
  await app.listen({ host: config.host, port: config.port })
  console.log(
    `scpi-softpanel server on http://${config.host}:${config.port}  (web ${hasWeb ? 'served' : 'dev-mode'})`,
  )
  console.log(`meter resource: ${config.meterResource}`)

  const shutdown = () => {
    console.log('\nshutting down...')
    poller.stop()
    bridge.stop()
    void app.close().then(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
