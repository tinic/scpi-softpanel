<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { useChartWindow } from '@/composables/useChartWindow'
import { useTempUnit } from '@/composables/useTempUnit'
import { convertTemp, formatValue, functionUnitSuffix, tempUnitLabel } from '@/lib/format'

/**
 * A classic panel meter, drawn from scratch: cream face, engraved arc scale with
 * an anti-parallax mirror band, red overload zones, knife-edge needle with a
 * counterweight, and a physically modeled taut-band movement (second-order
 * spring/damper with peg bounce). Signed functions get a center-zero null-meter
 * scale; unsigned start at 0. Full scale follows the instrument's manual range
 * exactly; in autorange it auto-selects a 1-2-5 decade from recent readings
 * (expands instantly, shrinks with hysteresis so the scale doesn't pump).
 */

const store = useMeterStore()
const { windowed } = useChartWindow()
const { tempUnit } = useTempUnit()

const HEIGHT = 310
const MAX_W = 760
const ALPHA = 40 // scale half-span, degrees from vertical
const PEG = 43.5 // mechanical stop, degrees

const SIGNED = new Set(['VOLT:DC', 'CURR:DC', 'TEMP'])

const wrap = ref<HTMLDivElement | null>(null)
const cv = ref<HTMLCanvasElement | null>(null)

let raf = 0
let lastT = 0

// -- movement physics (angle in degrees) -------------------------------------
let theta = 0
let vel = 0
const OMEGA = 9 // natural frequency, rad/s — ~0.5 s settle like a bench meter
const ZETA = 0.55 // slightly underdamped: a touch of overshoot reads as "real"

// -- full-scale selection ------------------------------------------------------
let fs = 1
let fsSettled = false // first reading snaps the scale; after that, hysteresis
let shrinkCandidateSince = 0

/** Smallest 1-2-5 decade ≥ x. */
function decade125(x: number): number {
  const e = Math.floor(Math.log10(x))
  for (const m of [1, 2, 5, 10]) {
    const d = m * 10 ** e
    if (x <= d * 1.0001) return d
  }
  return 10 ** (e + 1)
}

function pickFullScale(now: number): number {
  const st = store.state
  // Manual range: the scale IS the instrument's range, like the front panel.
  if (st?.autoRange === false && st.range && st.range !== 'AUTO') {
    const r = Number(st.range)
    if (Number.isFinite(r) && r > 0) return r
  }
  // Autorange: 1-2-5 decade over the last 15 s of readings.
  const fn = st?.function
  let maxAbs = 0
  for (const r of windowed.value) {
    if (r.function !== fn || !Number.isFinite(r.value) || now - r.ts > 15000) continue
    const v = fn === 'TEMP' ? convertTemp(r.value, tempUnit.value) : r.value
    const a = Math.abs(v)
    if (a > maxAbs) maxAbs = a
  }
  if (maxAbs === 0) return fs
  const want = decade125(maxAbs)
  if (!fsSettled) {
    fsSettled = true
    return want
  }
  if (want > fs) {
    shrinkCandidateSince = 0
    return want // never clip: expand immediately
  }
  if (want < fs) {
    // Shrink only after the smaller scale has been sufficient for a while.
    if (!shrinkCandidateSince) shrinkCandidateSince = now
    if (now - shrinkCandidateSince > 3000) {
      shrinkCandidateSince = 0
      return want
    }
  } else {
    shrinkCandidateSince = 0
  }
  return fs
}

// -- scale numerals ------------------------------------------------------------
const PREF_EXP: Record<string, number> = { p: -12, n: -9, 'µ': -6, m: -3, '': 0, k: 3, M: 6, G: 9 }

function unitInfo(): { legend: string; prefExp: number } {
  const st = store.state
  const fn = st?.function
  if (fn === 'TEMP') return { legend: tempUnitLabel(tempUnit.value), prefExp: 0 }
  if (fn === 'CONT') return { legend: 'Ω', prefExp: 0 }
  const base = store.lastReading?.unit ?? 'V'
  const f = formatValue(fs, base)
  const sym = f.unit.slice(0, f.unit.length - base.length)
  return { legend: f.unit + functionUnitSuffix(fn ?? undefined), prefExp: PREF_EXP[sym] ?? 0 }
}

function numeral(v: number, prefExp: number): string {
  const s = v / 10 ** prefExp
  const t = Math.abs(s) >= 100 ? s.toFixed(0) : String(Number(s.toPrecision(3)))
  return t
}

// -- face rendering (cached offscreen; redrawn only when geometry changes) ------
let face: HTMLCanvasElement | null = null
let faceKey = ''

function P(cx: number, py: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.sin(a), py - r * Math.cos(a)]
}

function drawFace(w: number, h: number, dpr: number, centerZero: boolean, legend: string, prefExp: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)

  // Bezel — dark housing with a chamfered inner lip.
  const rr = (x: number, y: number, ww: number, hh: number, r: number) => {
    g.beginPath()
    g.roundRect(x, y, ww, hh, r)
  }
  const bez = g.createLinearGradient(0, 0, 0, h)
  bez.addColorStop(0, '#3a3b41')
  bez.addColorStop(0.08, '#26272c')
  bez.addColorStop(1, '#101014')
  rr(0, 0, w, h, 16)
  g.fillStyle = bez
  g.fill()
  rr(1, 1, w - 2, h - 2, 15)
  g.strokeStyle = 'rgba(255,255,255,0.08)'
  g.lineWidth = 1
  g.stroke()

  // Face plate.
  const fx = 16
  const fy = 16
  const fw = w - 32
  const fh = h - 32
  const cream = g.createLinearGradient(0, fy, 0, fy + fh)
  cream.addColorStop(0, '#f8f3e5')
  cream.addColorStop(0.75, '#f1ead6')
  cream.addColorStop(1, '#e7dfc8')
  rr(fx, fy, fw, fh, 7)
  g.fillStyle = cream
  g.fill()
  g.save()
  rr(fx, fy, fw, fh, 7)
  g.clip()
  // Inner shadow cast by the bezel onto the face.
  g.shadowColor = 'rgba(0,0,0,0.45)'
  g.shadowBlur = 18
  g.lineWidth = 10
  g.strokeStyle = 'rgba(0,0,0,0)'
  rr(fx - 5, fy - 5, fw + 10, fh + 10, 10)
  g.stroke()

  // Scale geometry: pivot near the face bottom, arc sweeping the top.
  const cx = w / 2
  const py = h - 40
  const R = py - fy - 28

  const ink = '#221f19'
  g.shadowColor = 'transparent'

  // Mirror band (anti-parallax): a thin bright silvered strip under the ticks,
  // cooler than the paper so it reads as glass, with crisp bounding rules.
  const m1 = R - 50
  const m2 = R - 40
  g.beginPath()
  g.arc(cx, py, m2, ((-ALPHA - 90) * Math.PI) / 180, ((ALPHA - 90) * Math.PI) / 180)
  g.arc(cx, py, m1, ((ALPHA - 90) * Math.PI) / 180, ((-ALPHA - 90) * Math.PI) / 180, true)
  g.closePath()
  const mir = g.createLinearGradient(0, py - m2, 0, py - m1)
  mir.addColorStop(0, '#eef0ec')
  mir.addColorStop(0.35, '#ffffff')
  mir.addColorStop(0.65, '#dfe3de')
  mir.addColorStop(1, '#c9cec8')
  g.fillStyle = mir
  g.fill()
  g.strokeStyle = 'rgba(70,66,54,0.8)'
  g.lineWidth = 0.8
  g.stroke()

  // Main arc.
  g.beginPath()
  g.arc(cx, py, R, ((-ALPHA - 90) * Math.PI) / 180, ((ALPHA - 90) * Math.PI) / 180)
  g.strokeStyle = ink
  g.lineWidth = 2.25
  g.stroke()

  // Red overload zones from full deflection to the peg.
  const red = (from: number, to: number) => {
    g.beginPath()
    g.arc(cx, py, R, ((from - 90) * Math.PI) / 180, ((to - 90) * Math.PI) / 180)
    g.strokeStyle = '#b3241f'
    g.lineWidth = 4
    g.stroke()
  }
  red(ALPHA, PEG - 0.5)
  if (centerZero) red(-PEG + 0.5, -ALPHA)

  // Ticks. Fractions are of full deflection: [-1,1] center-zero, [0,1] otherwise.
  const frac2deg = (f: number) => (centerZero ? f * ALPHA : (f * 2 - 1) * ALPHA)
  const tick = (f: number, len: number, lw: number) => {
    const d = frac2deg(f)
    const [x1, y1] = P(cx, py, R, d)
    const [x2, y2] = P(cx, py, R - len, d)
    g.beginPath()
    g.moveTo(x1, y1)
    g.lineTo(x2, y2)
    g.strokeStyle = ink
    g.lineWidth = lw
    g.stroke()
  }
  const lo = centerZero ? -1 : 0
  for (let f = lo; f <= 1.0001; f += 0.05) tick(f, 9, 1)
  for (let f = lo; f <= 1.0001; f += 0.25) tick(f, 13, 1.5)
  for (let f = lo; f <= 1.0001; f += 0.5) tick(f, 17, 2.2)

  // Numerals just inside the ticks, upright like a printed dial.
  g.fillStyle = ink
  g.font = '600 13.5px "Noto Sans", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const step = centerZero ? 0.5 : 0.25
  for (let f = lo; f <= 1.0001; f += step) {
    const v = centerZero ? f * fs : f * fs
    const [tx, ty] = P(cx, py, R - 27, frac2deg(f))
    g.fillText(numeral(v, prefExp), tx, ty)
  }

  // Unit legend — the big engraved marking under the scale.
  g.font = 'italic 700 30px Georgia, "Times New Roman", serif'
  g.fillStyle = '#2b2822'
  g.fillText(legend, cx, py - R * 0.42)

  // Maker's small print, tucked down by the hub like a real dial.
  g.font = '600 9px "Noto Sans", sans-serif'
  g.fillStyle = 'rgba(43,40,34,0.62)'
  g.fillText('SCPI SOFTPANEL', cx, py - 52)
  g.font = '500 8px "Noto Sans", sans-serif'
  g.fillText('TAUT BAND · CL 1.5 · MOD SDM3045X', cx, py - 40)

  g.restore()
  return c
}

// -- per-frame render -----------------------------------------------------------
function frame(t: number): void {
  raf = requestAnimationFrame(frame)
  if (!wrap.value || !cv.value) return
  const cssW = Math.min(wrap.value.clientWidth, MAX_W)
  if (cssW === 0 || document.hidden) return
  const dpr = window.devicePixelRatio || 1
  const w = cssW
  const h = HEIGHT
  const now = Date.now()

  const st = store.state
  const fn = st?.function
  const centerZero = SIGNED.has(fn ?? '')
  fs = pickFullScale(now)
  const { legend, prefExp } = unitInfo()

  // Rebuild the cached face only when something it depends on changes.
  const key = `${w}|${h}|${dpr}|${centerZero}|${fs}|${legend}|${prefExp}`
  if (key !== faceKey) {
    face = drawFace(w, h, dpr, centerZero, legend, prefExp)
    faceKey = key
  }

  if (cv.value.width !== Math.round(w * dpr) || cv.value.height !== Math.round(h * dpr)) {
    cv.value.width = Math.round(w * dpr)
    cv.value.height = Math.round(h * dpr)
    cv.value.style.width = `${w}px`
    cv.value.style.height = `${h}px`
  }

  // Target deflection.
  const r = store.lastReading
  let target = centerZero ? 0 : -ALPHA // resting position with no signal
  if (r && r.function === fn && now - r.ts < 5000) {
    let f: number
    if (!Number.isFinite(r.value)) {
      f = r.value < 0 ? -1.09 : 1.09 // overload: drive onto the peg
    } else {
      const v = fn === 'TEMP' ? convertTemp(r.value, tempUnit.value) : r.value
      f = v / fs
    }
    if (centerZero) target = Math.max(-1.09, Math.min(1.09, f)) * ALPHA
    else target = (Math.max(-0.045, Math.min(1.09, f)) * 2 - 1) * ALPHA
  }

  // Integrate the movement (semi-implicit Euler, dt clamped across tab naps).
  const dt = Math.min(Math.max((t - lastT) / 1000, 0.001), 0.05)
  lastT = t
  vel += (OMEGA * OMEGA * ((target - theta) * (Math.PI / 180)) - 2 * ZETA * OMEGA * vel) * dt
  theta += vel * (180 / Math.PI) * dt
  if (theta > PEG) {
    theta = PEG
    if (vel > 0) vel = -vel * 0.25 // bounce off the mechanical stop
  } else if (theta < -PEG) {
    theta = -PEG
    if (vel < 0) vel = -vel * 0.25
  }

  const g = cv.value.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (face) g.drawImage(face, 0, 0, w, h)

  // Needle, over the face, under the glass.
  const cx = w / 2
  const py = h - 40
  const R = py - 16 - 28
  g.save()
  g.translate(cx, py)
  g.rotate((theta * Math.PI) / 180)
  // Knife-edge pointer with a drop shadow that falls onto the face.
  g.shadowColor = 'rgba(30,20,10,0.30)'
  g.shadowOffsetX = 3
  g.shadowOffsetY = 5
  g.shadowBlur = 4
  g.beginPath()
  g.moveTo(-2.1, 12)
  g.lineTo(-0.55, -(R - 6))
  g.lineTo(0.55, -(R - 6))
  g.lineTo(2.1, 12)
  g.closePath()
  const steel = g.createLinearGradient(-2, 0, 2, 0)
  steel.addColorStop(0, '#1c1c22')
  steel.addColorStop(0.5, '#3a3a45')
  steel.addColorStop(1, '#131318')
  g.fillStyle = steel
  g.fill()
  // Counterweight tail (kept short so it never leaves the face).
  g.beginPath()
  g.rect(-1.4, 12, 2.8, 12)
  g.fill()
  g.beginPath()
  g.arc(0, 21, 4.6, 0, Math.PI * 2)
  g.fillStyle = '#22222a'
  g.fill()
  g.restore()

  // Hub with a screw slot.
  g.save()
  g.translate(cx, py)
  const hub = g.createRadialGradient(-4, -5, 2, 0, 0, 15)
  hub.addColorStop(0, '#5b5c66')
  hub.addColorStop(0.55, '#2c2d34')
  hub.addColorStop(1, '#121217')
  g.beginPath()
  g.arc(0, 0, 14, 0, Math.PI * 2)
  g.fillStyle = hub
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.6)'
  g.lineWidth = 1
  g.stroke()
  g.rotate(0.45)
  g.beginPath()
  g.moveTo(-9, 0)
  g.lineTo(9, 0)
  g.strokeStyle = 'rgba(0,0,0,0.55)'
  g.lineWidth = 2.4
  g.stroke()
  g.restore()

  // Glass: a soft diagonal sheen over everything.
  g.save()
  g.beginPath()
  g.roundRect(16, 16, w - 32, h - 32, 7)
  g.clip()
  const sheen = g.createLinearGradient(0, 0, w * 0.55, h)
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)')
  sheen.addColorStop(0.35, 'rgba(255,255,255,0.05)')
  sheen.addColorStop(0.55, 'rgba(255,255,255,0)')
  g.fillStyle = sheen
  g.beginPath()
  g.moveTo(16, 16)
  g.lineTo(w * 0.52, 16)
  g.lineTo(w * 0.24, h - 16)
  g.lineTo(16, h - 16)
  g.closePath()
  g.fill()
  g.restore()
}

onMounted(() => {
  lastT = performance.now()
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div ref="wrap" class="meter">
    <canvas ref="cv" />
  </div>
</template>

<style scoped>
.meter {
  display: flex;
  justify-content: center;
}
.meter canvas {
  display: block;
  border-radius: 16px;
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.45),
    0 2px 6px rgba(0, 0, 0, 0.5);
}
</style>
