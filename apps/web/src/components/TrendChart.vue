<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { Reading } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { useChartWindow } from '@/composables/useChartWindow'
import { useDisplay } from '@/composables/useDisplay'
import { useLimits } from '@/composables/useLimits'
import { cssVar, useTheme } from '@/composables/useTheme'
import {
  canvasLabel,
  exportPng,
  fileStamp,
  hBand,
  hLine,
  makeTip,
  placeTip,
  stepTicks,
  themedAxis,
  vLine,
} from '@/lib/chart'
import UiIcon from './UiIcon.vue'

/**
 * Live trend of the current function in its display unit (axis scaled to one SI
 * prefix, e.g. mVDC). Drag to zoom (the zoom holds while new readings arrive),
 * double-click to return to live. Click a point to set a Δ reference; the tooltip
 * then shows Δt / Δvalue from it. Limits and markers are drawn on the plot.
 */

const store = useMeterStore()
const { windowed } = useChartWindow()
const { channel } = useDisplay()
const { limits } = useLimits()
const { resolved: theme } = useTheme()

const el = ref<HTMLDivElement | null>(null)
const HEIGHT = 300

let plot: uPlot | null = null
let ro: ResizeObserver | null = null

// What's currently plotted, so hooks can map back to readings and display values.
let view: Reading[] = []
let div = 1
const axisUnit = ref('')
const zoomed = ref(false)
let zoomRange: { min: number; max: number } | null = null
const refIdx = ref<number | null>(null)
let refTs: number | null = null

function buildData(): uPlot.AlignedData {
  const fn = store.state?.function
  const ch = channel.value
  view = windowed.value.filter((r) => r.function === fn)
  let maxAbs = 0
  const vals = view.map((r) => {
    const v = ch.value(r)
    if (Number.isFinite(v) && Math.abs(v) > maxAbs) maxAbs = Math.abs(v)
    return v
  })
  const ax = ch.axis(maxAbs)
  div = ax.div
  axisUnit.value = ax.unit
  const xs = new Array<number>(view.length)
  const ys = new Array<number | null>(view.length)
  for (let i = 0; i < view.length; i++) {
    xs[i] = view[i].ts / 1000
    ys[i] = Number.isFinite(vals[i]) ? vals[i] / div : null
  }
  // Keep the Δ reference on the same reading as the window slides.
  refIdx.value = refTs == null ? null : view.findIndex((r) => r.ts === refTs)
  if (refIdx.value === -1) {
    refIdx.value = null
    refTs = null
  }
  return [xs, ys]
}

const fmt = (v: number) => {
  const f = channel.value.format(v)
  return `${f.sign}${f.text} ${f.unit}`.trim()
}
const fmtDelta = (v: number) => {
  const f = channel.value.format(Math.abs(v), { delta: true })
  return `${v < 0 ? '−' : '+'}${f.text} ${f.unit}`.trim()
}
function fmtDt(s: number): string {
  const a = Math.abs(s)
  const t =
    a < 1
      ? `${(a * 1000).toFixed(0)} ms`
      : a < 120
        ? `${a.toFixed(2)} s`
        : `${(a / 60).toFixed(1)} min`
  return `${s < 0 ? '−' : '+'}${t}`
}

function tooltipPlugin(): uPlot.Plugin {
  let t: ReturnType<typeof makeTip>
  return {
    hooks: {
      init: (u) => {
        t = makeTip(u)
      },
      setCursor: (u) => {
        const idx = u.cursor.idx
        const r = idx == null ? undefined : view[idx]
        if (!r) {
          t.tip.style.display = 'none'
          return
        }
        const v = channel.value.value(r)
        const ref = refIdx.value != null ? view[refIdx.value] : null
        if (ref && idx !== refIdx.value) {
          t.a.textContent = r.overload ? 'OL' : `Δ ${fmtDelta(v - channel.value.value(ref))}`
          t.b.textContent = `${fmtDt((r.ts - ref.ts) / 1000)} · ${fmt(v)}`
        } else {
          t.a.textContent = r.overload ? 'OL' : fmt(v)
          t.b.textContent = new Date(r.ts).toLocaleTimeString()
        }
        t.tip.style.display = 'flex'
        placeTip(u, t.tip)
      },
    },
  }
}

// Limits (dashed lines + faint shading outside), markers, and the Δ reference.
function overlayPlugin(): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const lim = limits.value
        const bad = cssVar('--chart-limit')
        if (lim.enabled) {
          const [ymin, ymax] = [u.scales.y.min ?? 0, u.scales.y.max ?? 0]
          const shade = cssVar('--bad-soft')
          if (lim.hi != null) {
            hBand(u, lim.hi / div, Math.max(ymax, lim.hi / div), shade)
            hLine(u, lim.hi / div, bad, 1.25, [6, 4])
          }
          if (lim.lo != null) {
            hBand(u, Math.min(ymin, lim.lo / div), lim.lo / div, shade)
            hLine(u, lim.lo / div, bad, 1.25, [6, 4])
          }
        }
        const mk = cssVar('--chart-marker')
        for (const m of store.state?.markers ?? []) {
          const px = vLine(u, m.ts / 1000, mk, 1.25, [3, 3])
          if (px != null) canvasLabel(u, m.text || '⚑', px, mk)
        }
        if (refIdx.value != null && view[refIdx.value]) {
          const r = view[refIdx.value]
          const px = vLine(u, r.ts / 1000, cssVar('--accent'), 1.25)
          if (px != null) canvasLabel(u, 'REF', px, cssVar('--accent'))
        }
      },
    },
  }
}

// Zoom bookkeeping: a drag-select zooms x; remember it so live data doesn't reset it.
function zoomPlugin(): uPlot.Plugin {
  let downX = 0
  let downY = 0
  return {
    hooks: {
      init: (u) => {
        u.over.addEventListener('mousedown', (e) => {
          downX = e.clientX
          downY = e.clientY
        })
        // A click without a drag toggles the Δ reference on the nearest point.
        u.over.addEventListener('click', (e) => {
          if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3) return
          const idx = u.cursor.idx
          if (idx == null || !view[idx]) return
          if (refIdx.value === idx) {
            refIdx.value = null
            refTs = null
          } else {
            refIdx.value = idx
            refTs = view[idx].ts
          }
          u.redraw()
        })
        u.over.addEventListener('dblclick', () => resetZoom())
      },
      setSelect: (u) => {
        if (u.select.width > 5) {
          zoomed.value = true
          zoomRange = {
            min: u.posToVal(u.select.left, 'x'),
            max: u.posToVal(u.select.left + u.select.width, 'x'),
          }
        }
      },
    },
  }
}

// Auto-range y, but always keep enabled limits in view so the band is visible.
function yRange(_u: uPlot, min: number, max: number): uPlot.Range.MinMax {
  if (min == null || max == null) return [0, 1]
  const lim = limits.value
  if (lim.enabled) {
    for (const b of [lim.lo, lim.hi]) {
      if (b == null) continue
      min = Math.min(min, b / div)
      max = Math.max(max, b / div)
    }
  }
  return uPlot.rangeNum(min, max, 0.1, true)
}

function options(width: number): uPlot.Options {
  return {
    width,
    height: HEIGHT,
    scales: { x: { time: true }, y: { range: yRange } },
    axes: [themedAxis(), themedAxis({ values: stepTicks, size: 70 })],
    series: [
      {},
      {
        label: 'value',
        stroke: cssVar('--chart-line'),
        width: 1.5,
        points: { show: false },
      },
    ],
    cursor: { drag: { x: true, y: false }, points: { size: 7 } },
    legend: { show: false },
    plugins: [tooltipPlugin(), overlayPlugin(), zoomPlugin()],
  }
}

function update(): void {
  if (!plot) return
  const data = buildData()
  if (zoomed.value && zoomRange) {
    plot.setData(data, false)
    plot.setScale('x', zoomRange)
  } else {
    plot.setData(data)
  }
}

function resetZoom(): void {
  zoomed.value = false
  zoomRange = null
  if (plot) plot.setData(buildData())
}

function create(): void {
  if (!el.value) return
  plot?.destroy()
  const width = el.value.clientWidth || 600
  plot = new uPlot(options(width), buildData(), el.value)
}

onMounted(() => {
  create()
  ro = new ResizeObserver(() => {
    // Skip zero-width (e.g. while collapsed or on the other tab) so the chart
    // restores cleanly when shown again.
    const w = el.value?.clientWidth ?? 0
    if (plot && w > 0) plot.setSize({ width: w, height: HEIGHT })
  })
  ro.observe(el.value!)
})

watch([windowed, channel], update)
watch(limits, update, { deep: true })
watch(
  () => store.state?.markers,
  () => plot?.redraw(),
)
watch(theme, create)
// A function switch is a new measurement: drop zoom and the Δ reference.
watch(
  () => store.state?.function,
  () => {
    refIdx.value = null
    refTs = null
    resetZoom()
  },
)

onBeforeUnmount(() => {
  ro?.disconnect()
  plot?.destroy()
})

function exportImage(): void {
  if (!plot) return
  const now = new Date()
  exportPng(
    plot,
    `${channel.value.label}${channel.value.mathTag ? ` · ${channel.value.mathTag}` : ''} — trend (${axisUnit.value})`,
    `${view.length} readings · ${now.toLocaleString()} · SCPI SoftPanel`,
    `scpi-trend-${fileStamp(now)}.png`,
  )
}
defineExpose({ exportImage })
</script>

<template>
  <div class="trend">
    <div class="over">
      <span v-if="axisUnit" class="unit-tag mono">{{ axisUnit }}</span>
      <button v-if="zoomed" class="chip" title="Back to live (double-click)" @click="resetZoom">
        <UiIcon name="zoom-out" :size="13" /> Live
      </button>
      <button
        v-if="refIdx != null"
        class="chip"
        title="Clear the Δ reference"
        @click="((refIdx = null), (refTs = null), plot?.redraw())"
      >
        Δ ref ✕
      </button>
    </div>
    <div ref="el" class="chart" />
    <p class="help">Drag to zoom · double-click for live · click a point to measure Δ from it</p>
  </div>
</template>

<style scoped>
.trend {
  position: relative;
}
.over {
  position: absolute;
  top: 2px;
  left: 4px;
  right: 8px;
  z-index: 4;
  display: flex;
  gap: 6px;
  align-items: center;
  pointer-events: none;
}
.over > * {
  pointer-events: auto;
}
.unit-tag {
  font-size: 11px;
  font-weight: 800;
  color: var(--muted);
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--panel-2);
  border: 1px solid var(--border);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  background: var(--accent-soft);
}
.chart {
  width: 100%;
  padding-top: 22px;
}
.help {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--faint);
  text-align: right;
}
/* The tooltip is created imperatively inside uPlot's overlay, so it needs :deep to
 * escape this component's scoping (it's a descendant of .chart, not of the template). */
.chart :deep(.tip) {
  position: absolute;
  pointer-events: none;
  z-index: 3;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 5px 9px;
  border-radius: 7px;
  background: var(--panel);
  border: 1px solid var(--border-strong);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  white-space: nowrap;
}
.chart :deep(.tip-v) {
  font-family: var(--mono);
  font-weight: 800;
  font-size: 14px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.chart :deep(.tip-t) {
  font-size: 10px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.chart :deep(.u-select) {
  background: var(--accent-soft);
}
</style>
