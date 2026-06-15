import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
// repo root is four levels up from apps/server/src/config.ts
const repoRoot = resolve(__dirname, '../../..')

// Load repo-root .env if present (overrides nothing already in the environment).
loadDotenv({ path: resolve(repoRoot, '.env') })

function env(key: string, fallback: string): string {
  const v = process.env[key]
  return v === undefined || v === '' ? fallback : v
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key]
  if (v === undefined || v === '') return fallback
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key]
  if (v === undefined || v === '') return fallback
  return /^(1|true|yes|on)$/i.test(v)
}

function resolveResource(): string {
  const explicit = env('METER_RESOURCE', '')
  if (explicit) return explicit
  const host = env('METER_HOST', '192.168.1.166')
  return `TCPIP::${host}::INSTR`
}

export interface Config {
  host: string
  port: number
  meterResource: string
  meterTimeoutMs: number
  meterProbePort: number
  meterBootSettleMs: number
  pollIntervalMs: number
  pollAutostart: boolean
  ringCapacity: number
  bridgePython: string
  bridgeScript: string
  webDist: string
}

export const config: Config = {
  host: env('HOST', '0.0.0.0'),
  port: envInt('PORT', 8080),
  meterResource: resolveResource(),
  meterTimeoutMs: envInt('METER_TIMEOUT_MS', 5000),
  meterProbePort: envInt('METER_PROBE_PORT', 5025),
  meterBootSettleMs: envInt('METER_BOOT_SETTLE_MS', 8000),
  pollIntervalMs: envInt('POLL_INTERVAL_MS', 100),
  pollAutostart: envBool('POLL_AUTOSTART', true),
  ringCapacity: envInt('RING_CAPACITY', 3600),
  bridgePython: resolve(repoRoot, env('BRIDGE_PYTHON', 'bridge/.venv/bin/python')),
  bridgeScript: resolve(repoRoot, 'bridge/bridge.py'),
  webDist: resolve(repoRoot, 'apps/web/dist'),
}
