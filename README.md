# SCPI SoftPanel

A browser control panel for SCPI bench instruments that have no web UI of their own —
built first for a **Siglent SDM3045X** bench multimeter, which exposes raw SCPI on TCP
5025 (and VXI-11 on 111) but serves no web page.

It runs on an always-on LAN host, owns the instrument's single control session, and
serves a live browser UI: real-time readout, function/range/NPLC controls, a trend
chart, and a raw-SCPI console.

```
browser (Vue 3)  ⇄  WebSocket  ⇄  Node/TS broker  ⇄  JSON-RPC/stdio  ⇄  Python+pyvisa  ⇄  instrument
                                   (all the logic)                      (the one VISA session)
```

## Why this shape

- **One control session.** The SDM accepts a single SCPI connection; the Python bridge
  owns it and every request is serialized through the broker. No connection-per-request.
- **Logic in TypeScript.** Polling cadence, state machine, reconnect, fan-out to N
  browsers, and the reading history all live in the Node server. The Python side only
  does `connect` / `query` / `write` over pyvisa (pure-python `pyvisa-py` backend, so no
  NI-VISA install and a clean container).
- **Pull, not push.** The meter doesn't stream; the broker polls (`READ?`) at a
  configurable interval and pushes results to browsers over WebSocket.

## Layout

```
packages/shared   TS contracts (zod schemas → types) shared by server + web
apps/server       Node + Fastify broker: bridge supervisor, meter controller, poller, WS hub
apps/web          Vue 3 + Vite UI: live readout, controls, uPlot trend, SCPI console
bridge            Python + pyvisa JSON-RPC executor (owns the single session)
```

## Develop

Requires Node 20+, pnpm, and Python 3.

```bash
# one-time: python bridge venv
python3 -m venv bridge/.venv && bridge/.venv/bin/pip install -r bridge/requirements.txt

pnpm install
cp .env.example .env        # point METER_RESOURCE / METER_HOST at your instrument
pnpm dev                    # server :8080 + Vite :5173 (proxies /api + /ws)
```

Open http://localhost:5173. The Vite dev server proxies the API/WebSocket to the broker.

## Production / Docker

```bash
pnpm build                  # builds the web bundle into apps/web/dist
pnpm --filter @scpi/server start   # serves UI + API + WS on :8080

# or, self-contained image (node + python bridge in one container):
docker build -t scpi-softpanel .
docker run --rm -p 8080:8080 -e METER_HOST=192.168.1.166 scpi-softpanel
```

## Configuration

All via environment (see `.env.example`): `METER_RESOURCE` / `METER_HOST`,
`METER_TIMEOUT_MS`, `POLL_INTERVAL_MS`, `POLL_AUTOSTART`, `RING_CAPACITY`, `PORT`, `HOST`,
`BRIDGE_PYTHON`.

## Scripts

| Command          | Description                           |
| ---------------- | ------------------------------------- |
| `pnpm dev`       | Run broker + web dev server together  |
| `pnpm build`     | Type-check and build the web bundle   |
| `pnpm typecheck` | `tsc` / `vue-tsc` across all packages |
| `pnpm lint`      | ESLint (flat config, TS + Vue)        |
| `pnpm test`      | Vitest unit tests                     |
| `pnpm format`    | Prettier check                        |
