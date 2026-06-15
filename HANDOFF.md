# Session handoff — scpi-softpanel

Living context so a fresh Claude session can continue without re-deriving anything.
Last updated: 2026-06-13.

## What this is

A self-built browser control panel for a **Siglent SDM3045X** bench multimeter (raw
SCPI on TCP 5025, VXI-11 on 111, **no built-in web UI**). Architecture:

```
Vue 3 + Vite + TS (apps/web)  ⇄ WebSocket ⇄  Node + Fastify + TS broker (apps/server)
                                              (all logic: poll, state, reconnect, fan-out, ring history)
                                                   ⇄ JSON-RPC/stdio ⇄ Python+pyvisa (bridge/, owns the 1 VISA session)
```

Shared zod contracts in `packages/shared`. See `README.md` for the full overview.

## Status

**Milestone 1 (skeleton + working live vertical slice) is COMPLETE and verified against
the real instrument.** Live readings, function/range/NPLC controls, trend chart, and a
raw-SCPI console all work browser↔meter. Full pipeline is green:
`pnpm typecheck · lint · test · build · format` + `python -m py_compile bridge/bridge.py`.

**Visual verification is DONE (2026-06-12):** all blind UI edits from the previous
session checked out in headless-Chromium screenshots against the live app — Iosevka
value display, centering, stats/clear-button alignment, collapsibles (console closed,
trend open). One fix made: Trend y-axis tick labels all collapsed to the same string
at µV-level spreads; `TrendChart.vue` now derives tick decimals from the tick
increment (`yTickValues`) and the y-axis gutter is 64px.

Pushed to `git@github.com:tinic/scpi-softpanel.git` (2026-06-12); GitHub Actions CI is
green. Commit + push directly on `main` is the established flow here.

## Milestone 2 — Rust port for a shippable desktop app (IN PROGRESS, 2026-06-15)

Goal: downloadable Win/mac/Linux app **and** keep the LAN-server model, from one
codebase. Plan: **Tauri** shell + a **Rust core** (`scpi-core`) that replaces BOTH the
Node broker and the Python bridge; the same core powers the desktop app and a headless
server binary. Decision rationale: instrument comms is pure TCP, so Python/pyvisa buys
nothing Rust can't do directly; one runtime → one small signed binary.

**DONE & verified against the live meter (serving the unchanged Vue frontend):**

- `rust/` Cargo workspace: `scpi-core` (lib) + `scpi-server` (headless Axum bin).
- `scpi-core`: serde wire contract matching `packages/shared` (camelCase, `type`-tagged
  unions), function metadata + probed ranges, **raw-socket SCPI client** (plain TCP on
  5025 — no VXI-11/RPC, no pyvisa), meter state machine + poll loop in one async task,
  ring store. 9 unit tests, clippy clean.
- `scpi-server`: Axum `/api/health · /api/state · /api/readings · /ws` with the exact
  same snapshot/state/reading/console/error + client-message contract, plus static UI
  serving. The existing Vue app connects to it **unchanged**.
- Verified: live readings stream, function/range/NPLC/continuity-threshold round-trips,
  trend chart, no page errors — all against the real SDM3045X over raw socket.

**Run the Rust server** (replaces the Node broker; both can't hold the meter at once):

```bash
. "$HOME/.cargo/env"
cd rust && cargo build --release
WEB_DIST=../apps/web/dist METER_HOST=192.168.1.166 METER_PORT=5025 PORT=8080 \
  ./target/release/scpi-server
```

⚠️ Raw socket means the meter is `TCPIP::host::5025::SOCKET` (env `METER_PORT`, def 5025),
NOT VXI-11/`::INSTR` like the Node path. The probe-gated boot-settle was a VXI-11-specific
mitigation; raw-socket connect is itself the gentle probe, so it's not ported.

**NEXT (task #5):** Tauri desktop shell reusing `scpi-core` (recommended: embedded Axum on
`127.0.0.1:<port>` + webview pointed at it, so the frontend stays byte-identical), Linux
bundle buildable here, Win/mac via CI (`tauri-action`). Then retire `apps/server` (Node)

- `bridge/` (Python). Old Node+Python stack still present and functional meanwhile.

## Environment (host: playhouse2)

- Linux/Proxmox host, LAN IP **192.168.1.184**. Meter at **192.168.1.166** (single
  control session only — never open two connections at once). It's a **VXI-11**
  instrument (`TCPIP::…::INSTR`, ONC-RPC); powering it on with the broker hammering
  VXI-11 opens used to wedge its boot. Reconnect is now **probe-gated** (`Meter.tick`):
  a cheap TCP probe to port 5025 first, plus an 8s boot-settle on the off→on
  transition, so no VXI-11/RPC traffic hits a booting meter. Tunable via
  `METER_PROBE_PORT` / `METER_BOOT_SETTLE_MS`. ⚠️ **Not yet validated against the real
  meter** (it was offline 2026-06-13/15) — power-cycle test it when the meter is back.
- **No passwordless sudo.** Install user-space only. (`apt` is available but prompts for a password.)
- **pnpm** pinned to **9.12.0** via `packageManager` in package.json (Node 20.19's bundled
  corepack can't run pnpm 11 — `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`). The shim is at
  `~/.local/bin/pnpm` (already on PATH).
- **Python bridge venv** at `bridge/.venv` (Python 3.13, pyvisa 1.16.2 + pyvisa-py 0.8.1).
- Harness quirk: **foreground `sleep` is blocked** — use background tasks / until-loops.

## Run / verify

```bash
pnpm dev                            # Vite :5173 (proxies /api + /ws) + broker :8080
pnpm --filter @scpi/server start    # prod: broker serves built UI + API + WS on :8080
# view at http://playhouse2:8080  (or :5173 in dev)

pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm format
```

The broker spawns the bridge, connects, and auto-starts polling. Because the meter is
single-session, **don't run two broker/dev instances at once** — they'll fight for it.

## UI customizations already made (don't re-derive / lose these)

All in `apps/web/`:

- **Iosevka ExtraBold embedded**: `src/assets/fonts/iosevka-extrabold.woff2` (full
  ~995 KB file — user explicitly chose NOT to subset). `@font-face` (weight 800) in
  `src/style.css`. Applied to the big value (`LiveReading.vue` `.mag`/`.num`) and the
  min/avg/max stat values (`.sv`).
- **Value font size = 96px** (doubled from 48).
- **Sign in a fixed-width 1ch column** so digits don't shift when the reading crosses
  zero. `lib/format.ts` `formatValue()` returns `{ sign, text, unit }` separately.
- **Poll interval default = 100ms** (`apps/server/src/config.ts`, `.env.example`,
  `ControlPanel.vue` `intervalInput`). NOTE: effective rate is gated by NPLC — at NPLC 10
  a `READ?` takes ~167–200ms, so drop NPLC to 1/0.3 for true 10Hz.
- **Clear (↺) button** for min/avg/max in `LiveReading.vue`: advances a `statsSince`
  marker so stats re-accumulate. Rendered as a 22px circular ghost button inline at the
  end of the stats row (`align-items: flex-end` aligns it with the value line).
- **No N stat.** It was removed (user request): the web readings ring caps at 3600
  entries (`MAX_READINGS`), so N saturated at 3600 and was meaningless. Note min/avg/max
  share the same window — they cover at most the last 3600 readings since clear.
- **Collapsible sections** via `components/CollapsibleSection.vue` (clickable header +
  rotating chevron, `defaultOpen` prop). **SCPI Console collapsed by default**
  (`:default-open="false"`); **Trend collapsible**, open by default. `TrendChart.vue`
  has a zero-width resize guard for collapse/expand.
- **LiveReading panel is centered** (was left-crammed).

- **Trend y-axis adaptive tick precision** (`TrendChart.vue` `yTickValues`): decimals
  derived from the tick increment so µV-scale spreads get distinct labels; axis size 64;
  tick labels in 11px monospace on both axes.
- **Design polish pass (2026-06-12, user asked for less "amateurish")**: unit in the big
  display is 38px Iosevka accent (was 24px sans); stats row sits on a hairline top
  border; status bar items are **pills** and the raw IDN string was replaced by the
  parsed model name (`StatusBar.vue` splits IDN on commas, full IDN on hover); card
  padding 20px; visible `:focus-visible` ring on buttons.
- **Controls = front-panel keypad (2026-06-12, user-driven rework)**: Function is a
  symbol button grid (V⎓ V∿ A⎓ A∿ Ω2W Ω4W ⊣⊢ Hz 1/f ◗)) ─▶|─ °C, full names in
  tooltips); Range is Auto + per-function preset buttons; NPLC presets come from shared
  `NPLC_CHOICES`. **Removed:** Refresh-state button (broker auto-refreshes after raw
  console writes — see `Meter.raw`), the poll-interval input (env default 100 ms is
  fine), and the free-text range field. Rows that don't apply to the active
  function (Range, NPLC, Beep <) are hidden entirely, not shown as n/a. All
  `.seg` rows share a
  `repeat(auto-fill, minmax(64px, 1fr))` grid so wrapped rows align like a keypad.
- **Fonts (all OFL, embedded in `assets/fonts/`)**: **Noto Sans** 400/600/700 is the
  app-wide UI font; **Iosevka ExtraBold** stays exclusively on measurement values
  (`.mag`/`.sv`/`.unit`); **JuliaMono** serves ONLY the instrument symbols via
  `unicode-range: U+2393, U+223F, U+22A2-22A3, U+2500, U+25B6, U+25D7, U+25FC`
  (family 'Tech Symbols', first in the root stack). U+2393 (DC ⎓) is missing from
  Iosevka, Noto Sans Symbols 2, and most system fonts — JuliaMono is the reason
  that glyph renders. Symbol picks were screenshot-compared in /tmp/sym-test.html.
- **Stats are per-function**: min/avg/max only aggregate readings whose `function`
  matches the current one (a function switch used to relabel old volts as Ω).
- **Continuity tone (2026-06-13)**: in CONT mode the browser plays a soft sine dyad
  (660+990 Hz, `lib/tone.ts`) while the reading is < 50 Ω (matches the meter's default
  `CONT:THR:VAL`; not synced if the user changes it on the meter). Mute pill next to
  the CONTINUITY label, preference in `localStorage['scpi.contSound']`; volume
  slider beside it (5-100%, `localStorage['scpi.contVolume']`, default 40) scales
  `MAX_GAIN` in `lib/tone.ts` live and plays a preview blip on release. Tone has a
  1.5 s staleness timer so it can't drone on if readings stall while shorted.
  **Threshold is settable**: "Beep <" preset row (1/10/50/100/500/1000 Ω) in the
  controls when CONT is active → `CONT:THR:VAL` on the meter (read back), surfaced
  as `state.contThreshold`; the browser tone uses the same value. ⚠️ The instrument
  resets the threshold to 50 Ω on EVERY CONFigure/function change (per programming
  guide) — the UI reflects that truthfully rather than re-applying a stored value.
  Display in CONT mode uses `formatContinuity`: plain ohms at 0.1 Ω resolution (no
  m/k scaling) for value and stats, and overload renders as muted "open", not OL. Web
  Audio unlocks on any prior click (e.g. selecting CONT in the UI).

### Instrument facts probed from the real SDM3045X (2026-06-12)

These live in `packages/shared/src/functions.ts` (`FUNCTION_INFO[fn].ranges`,
`NPLC_CHOICES`) — don't re-derive from datasheet memory; the meter was probed by
stepping `SENS:<fn>:RANG` and reading back:

- DCV 200mV/2/20/200/1000V · ACV …/750V · DCI 200µA…2A,10A · ACI 20mA…2A,10A ·
  RES/FRES 200Ω…2MΩ,**10MΩ**,100MΩ · CAP 2nF…200µF,**10mF**
- **NPLC: only 0.3 / 1 / 10.** NPLC 100 is silently clamped to 10 (this is why
  `Meter.setNplc/setRange` read back instead of trusting the patch).
- `SENS:TEMP:NPLC?` errors (-113) → TEMP has `supportsNplc: false`.

All of the above are **visually verified** against the live app (2026-06-12), including
the 720px single-column layout and live function/range switching (DCV↔Ω2W).

## Playwright / visual self-verification

- MCP config (in `~/.claude.json`, project-scoped): `npx @playwright/mcp@latest
--browser chromium`. The `--browser chromium` flag is REQUIRED — the default `chrome`
  channel isn't installed and can't be (no sudo). Chromium rev **1223** lives in
  `~/.cache/ms-playwright`; headless launch works.
- MCP server args are fixed at session startup — if the MCP errors with "Chromium
  distribution 'chrome' is not found", the session predates the config fix.
- **Working fallback (proven):** drive playwright-core directly via node. A matching
  playwright-core 1.60 (chromium rev 1223) is in the npx cache at
  `~/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core` (the other npx copy wants
  rev 1226 — don't use it). Script pattern saved at `/tmp/shot.mjs` last session:
  launch headless, viewport 1440×1000, goto + networkidle + ~1.5s wait for WS, screenshot.
- To screenshot the app: the broker must be running (`pnpm --filter @scpi/server start`,
  holds the single meter session — check `ss -tlnp | grep 8080` first; don't start a
  second one), then point the browser at `http://localhost:8080`.

## Likely next steps

1. Possible follow-ups: SQLite persistence behind the `ReadingStore` interface (currently
   in-memory ring); build/run the Docker image (Dockerfile ready; Docker not installed here).

## File map (source)

```
packages/shared/src/{functions,messages,index}.ts   contracts + SDM function metadata
apps/server/src/
  config.ts            env config (defaults: meter .166, poll 100ms, port 8080)
  bridge/BridgeClient.ts   spawns+supervises python, serialized JSON-RPC, auto-respawn
  meter/Meter.ts       SCPI translation, state, reconnect
  meter/Poller.ts      self-rescheduling poll loop (NPLC-safe)
  store/ReadingStore.ts    ReadingStore interface + RingReadingStore (in-memory)
  ws/hub.ts            WS client registry + validated fan-out
  index.ts             wiring + Fastify HTTP/WS + static serve
apps/web/src/
  stores/meter.ts      Pinia WS client (state + readings ring + console)
  lib/format.ts        engineering-notation formatter (sign split out)
  components/{LiveReading,ControlPanel,TrendChart,RawConsole,StatusBar,CollapsibleSection}.vue
bridge/bridge.py       pyvisa JSON-RPC executor (owns the single session)
```
