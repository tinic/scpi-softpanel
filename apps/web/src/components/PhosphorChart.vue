<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { useChartWindow } from '@/composables/useChartWindow'
import { useTempUnit } from '@/composables/useTempUnit'
import { convertTemp, formatValue, functionUnitSuffix, tempUnitLabel } from '@/lib/format'
import {
  PALETTE_TINT,
  PhosphorRenderer,
  SEG_STRIDE,
  type PhosphorPalette,
} from '@/lib/phosphor/renderer'

const store = useMeterStore()
const { windowed } = useChartWindow()
const { tempUnit } = useTempUnit()

const HEIGHT = 300

// -- preferences (persisted) -------------------------------------------------
type Mode = 'strip' | 'sweep'
function pref<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  const v = localStorage.getItem(key) as T | null
  return v !== null && valid.includes(v) ? v : fallback
}

const MODES = ['strip', 'sweep'] as const
const WINDOWS = ['30', '60', '300'] as const
const SWEEPS = ['2', '5', '10', '30'] as const
const TAUS = ['2', '8', '30', 'inf'] as const
const PALETTES = ['green', 'cyan', 'amber'] as const

const mode = ref<Mode>(pref('scpi.phosphor.mode', 'strip', MODES))
const windowSec = ref(pref('scpi.phosphor.window', '60', WINDOWS))
const sweepSec = ref(pref('scpi.phosphor.sweep', '5', SWEEPS))
const tau = ref(pref('scpi.phosphor.tau', 'inf', TAUS))
const palette = ref<PhosphorPalette>(pref('scpi.phosphor.palette', 'green', PALETTES))
const gainPct = ref(Number(localStorage.getItem('scpi.phosphor.gain') ?? 50))

const setMode = (v: Mode) => {
  mode.value = v
  localStorage.setItem('scpi.phosphor.mode', v)
}
const setWindow = (v: (typeof WINDOWS)[number]) => {
  windowSec.value = v
  localStorage.setItem('scpi.phosphor.window', v)
}
const setSweep = (v: (typeof SWEEPS)[number]) => {
  sweepSec.value = v
  localStorage.setItem('scpi.phosphor.sweep', v)
}
const setTau = (v: (typeof TAUS)[number]) => {
  tau.value = v
  localStorage.setItem('scpi.phosphor.tau', v)
}
const setPalette = (v: PhosphorPalette) => {
  palette.value = v
  localStorage.setItem('scpi.phosphor.palette', v)
}
function onGain(): void {
  localStorage.setItem('scpi.phosphor.gain', String(gainPct.value))
}
/** Slider 0..100 → gain 0.1..10, log-mapped, 50 = ×1. */
const gain = computed(() => 10 ** ((gainPct.value - 50) / 50))

// -- rendering ----------------------------------------------------------------
const wrap = ref<HTMLDivElement | null>(null)
const cv = ref<HTMLCanvasElement | null>(null)
const glFail = ref(false)
const hasData = ref(false)

let renderer: PhosphorRenderer | null = null
let raf = 0

// Smoothed y-scale: expands fast so nothing clips, shrinks slowly so noise
// doesn't pump the axis. Stateless GL means a moving scale just glides.
let curLo = NaN
let curHi = NaN

// Reused CPU buffers (3600-reading ring upper-bounds everything).
const MAX = 4000
const segs = new Float32Array(MAX * SEG_STRIDE)
const px = new Float32Array(MAX)
const py = new Float32Array(MAX)
const page = new Float32Array(MAX)
const pbrk = new Uint8Array(MAX)

const hiLabel = ref('')
const midLabel = ref('')
const loLabel = ref('')
let lastLabelAt = 0

const unitLabel = computed(() => {
  const r = store.lastReading
  if (!r) return ''
  if (r.function === 'CONT') return 'Ω'
  if (r.function === 'TEMP') return tempUnitLabel(tempUnit.value)
  return r.unit + functionUnitSuffix(r.function)
})

const xHint = computed(() =>
  mode.value === 'strip'
    ? `${windowSec.value} s window · ${Number(windowSec.value) / 10} s/div`
    : `${Number(sweepSec.value) / 10} s/div sweep`,
)

function frame(): void {
  raf = requestAnimationFrame(frame)
  if (!renderer?.ok || !wrap.value || !cv.value) return
  const cssW = wrap.value.clientWidth
  if (cssW === 0 || document.hidden) return
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(cssW * dpr)
  const h = Math.round(HEIGHT * dpr)
  renderer.resize(w, h)

  const fn = store.state?.function
  const rs = windowed.value
  const now = Date.now()
  const winMs = Number(windowSec.value) * 1000
  const sweepMs = Number(sweepSec.value) * 1000
  const gapMs = Math.max(3 * (store.state?.intervalMs ?? 500), 1500)
  const tauS = tau.value === 'inf' ? Infinity : Number(tau.value)

  // Collect visible points of the active function into normalized coords.
  let n = 0
  let lo = Infinity
  let hi = -Infinity
  let prevTs = 0
  let prevX = -1
  for (const r of rs) {
    if (r.function !== fn || !Number.isFinite(r.value) || n >= MAX) continue
    const v = fn === 'TEMP' ? convertTemp(r.value, tempUnit.value) : r.value
    let x: number
    let brk = n === 0 || r.ts - prevTs > gapMs ? 1 : 0
    if (mode.value === 'strip') {
      x = 1 - (now - r.ts) / winMs
      if (x < 0) continue
      if (x > 1) x = 1
    } else {
      x = (r.ts % sweepMs) / sweepMs
      if (x < prevX) brk = 1 // sweep wrapped: don't draw the retrace
    }
    px[n] = x
    py[n] = v
    page[n] = (now - r.ts) / 1000
    pbrk[n] = brk
    prevTs = r.ts
    prevX = x
    if (v < lo) lo = v
    if (v > hi) hi = v
    n++
  }
  hasData.value = n > 0

  if (n > 0) {
    // Target scale with 8% headroom; degenerate (flat) traces get a floor.
    const span = Math.max(hi - lo, Math.abs(hi) * 1e-6, 1e-9)
    const tLo = lo - span * 0.08
    const tHi = hi + span * 0.08
    if (!Number.isFinite(curLo)) {
      curLo = tLo
      curHi = tHi
    } else {
      const kLo = tLo < curLo ? 0.3 : 0.03
      const kHi = tHi > curHi ? 0.3 : 0.03
      curLo += (tLo - curLo) * kLo
      curHi += (tHi - curHi) * kHi
    }
  }

  // Emit capsule segments in device px. Intensity carries the phosphor physics:
  // age decay × beam-speed dimming (constant beam energy spread over the path,
  // so dwell is bright and fast slews are faint).
  const sigma = 1.6 * dpr
  const energy = 6.0 * dpr
  const yspan = curHi - curLo
  let count = 0
  const X = (i: number) => px[i] * w
  const Y = (i: number) => ((py[i] - curLo) / yspan) * h
  for (let i = 0; i < n; i++) {
    const connPrev = i > 0 && !pbrk[i]
    const connNext = i < n - 1 && !pbrk[i + 1]
    if (!connPrev && connNext) continue // run start: covered by the next segment
    const o = count * SEG_STRIDE
    if (connPrev) {
      segs[o] = X(i - 1)
      segs[o + 1] = Y(i - 1)
    } else {
      segs[o] = X(i) // isolated sample → zero-length capsule (a dot)
      segs[o + 1] = Y(i)
    }
    segs[o + 2] = X(i)
    segs[o + 3] = Y(i)
    const len = Math.hypot(segs[o + 2] - segs[o], segs[o + 3] - segs[o + 1])
    const decay = tauS === Infinity ? 1 : Math.exp(-page[i] / tauS)
    // Sub-linear slew dimming: pure 1/len is physical but makes steep noise
    // segments vanish entirely; 1/len^0.7 keeps them faint yet traceable.
    segs[o + 4] = (energy * decay) / (len ** 0.7 + 2 * sigma)
    count++
  }

  renderer.render(segs, count, { gain: gain.value, tint: PALETTE_TINT[palette.value], sigma })

  if (now - lastLabelAt > 250) {
    lastLabelAt = now
    if (Number.isFinite(curLo)) {
      const fmt = (v: number) => {
        const f = formatValue(v, '', 4)
        return `${f.sign}${f.text}${f.unit}`
      }
      hiLabel.value = fmt(curHi)
      midLabel.value = fmt((curHi + curLo) / 2)
      loLabel.value = fmt(curLo)
    }
  }
}

onMounted(() => {
  if (!cv.value) return
  renderer = new PhosphorRenderer(cv.value)
  glFail.value = !renderer.ok
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  renderer?.dispose()
  renderer = null
})
</script>

<template>
  <div class="phos">
    <div class="ctl">
      <div class="seg">
        <button v-for="m in MODES" :key="m" :class="{ on: mode === m }" @click="setMode(m)">
          {{ m === 'strip' ? 'Strip' : 'Sweep' }}
        </button>
      </div>
      <div v-if="mode === 'strip'" class="seg">
        <button
          v-for="s in WINDOWS"
          :key="s"
          :class="{ on: windowSec === s }"
          @click="setWindow(s)"
        >
          {{ Number(s) >= 60 ? `${Number(s) / 60} min` : `${s} s` }}
        </button>
      </div>
      <div v-else class="seg">
        <button v-for="s in SWEEPS" :key="s" :class="{ on: sweepSec === s }" @click="setSweep(s)">
          {{ s }} s
        </button>
      </div>
      <div class="seg" title="Persistence — how long a trace glows before fading">
        <button v-for="t in TAUS" :key="t" :class="{ on: tau === t }" @click="setTau(t)">
          {{ t === 'inf' ? '∞' : `${t} s` }}
        </button>
      </div>
      <div class="seg pal">
        <button
          v-for="p in PALETTES"
          :key="p"
          :class="[p, { on: palette === p }]"
          :title="`${p} phosphor`"
          @click="setPalette(p)"
        />
      </div>
      <input
        v-model.number="gainPct"
        class="gain"
        type="range"
        min="0"
        max="100"
        title="Intensity"
        @input="onGain"
      />
    </div>
    <div ref="wrap" class="screen" :style="{ height: `${HEIGHT}px` }">
      <canvas ref="cv" />
      <template v-if="hasData">
        <span class="ylab top">{{ hiLabel }}</span>
        <span class="ylab mid">{{ midLabel }}</span>
        <span class="ylab bot">{{ loLabel }}</span>
        <span class="unit">{{ unitLabel }}</span>
        <span class="xhint">{{ xHint }}</span>
      </template>
      <div v-if="glFail" class="empty">WebGL2 is not available in this browser</div>
      <div v-else-if="!hasData" class="empty">waiting for readings…</div>
    </div>
  </div>
</template>

<style scoped>
.phos {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ctl {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.seg {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  overflow: hidden;
}
.seg button {
  border: none;
  border-radius: 0;
  background: none;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--muted);
}
.seg button + button {
  border-left: 1px solid var(--border);
}
.seg button.on {
  background: var(--panel-2);
  color: var(--text);
}
.seg.pal button {
  width: 26px;
  height: 22px;
  position: relative;
}
.seg.pal button::after {
  content: '';
  position: absolute;
  inset: 50% auto auto 50%;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  opacity: 0.45;
}
.seg.pal button.on::after {
  opacity: 1;
  box-shadow: 0 0 6px currentColor;
}
.seg.pal button.green::after {
  background: #4ade4a;
  color: #4ade4a;
}
.seg.pal button.cyan::after {
  background: #45e6ff;
  color: #45e6ff;
}
.seg.pal button.amber::after {
  background: #ffb03a;
  color: #ffb03a;
}
.gain {
  appearance: none;
  width: 90px;
  height: 4px;
  border-radius: 2px;
  background: var(--border);
  cursor: pointer;
}
.gain::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--muted);
}
.gain::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: none;
  border-radius: 50%;
  background: var(--muted);
}

.screen {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  /* Slightly inset bezel so the lit phosphor reads as a tube, not a div. */
  box-shadow:
    inset 0 0 24px rgba(0, 0, 0, 0.55),
    inset 0 0 2px rgba(0, 0, 0, 0.8);
  background: #000;
}
.screen canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.ylab {
  position: absolute;
  left: 6px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.9);
  pointer-events: none;
}
.ylab.top {
  top: 4px;
}
.ylab.mid {
  top: 50%;
  transform: translateY(-50%);
}
.ylab.bot {
  bottom: 4px;
}
.unit {
  position: absolute;
  top: 6px;
  right: 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  pointer-events: none;
}
.xhint {
  position: absolute;
  bottom: 4px;
  right: 8px;
  font-family: ui-monospace, monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  pointer-events: none;
}
.empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 13px;
}
</style>
