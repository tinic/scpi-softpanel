<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useMeterStore } from '@/stores/meter'
import { useChartWindow } from '@/composables/useChartWindow'
import { useDisplay } from '@/composables/useDisplay'
import { useLimits } from '@/composables/useLimits'
import { cssVar, useTheme } from '@/composables/useTheme'
import { exportPng, fileStamp, makeTip, placeTip, stepTicks, themedAxis, vLine } from '@/lib/chart'

const store = useMeterStore()
const { windowed } = useChartWindow()
const { channel } = useDisplay()
const { limits } = useLimits()
const { resolved: theme } = useTheme()
const el = ref<HTMLDivElement | null>(null)
const HEIGHT = 300

let plot: uPlot | null = null
let ro: ResizeObserver | null = null

interface Bins {
  centers: number[]
  counts: number[]
  lo: number
  binWidth: number
  total: number
  mean: number
  std: number
  /** Axis scale: plotted x = display value / div. */
  div: number
}
const empty = (): Bins => ({
  centers: [],
  counts: [],
  lo: 0,
  binWidth: 0,
  total: 0,
  mean: NaN,
  std: NaN,
  div: 1,
})
let bins: Bins = empty()
const axisUnit = ref('')

// Bin the current function's finite readings in the display unit (mixing units
// across a function switch would be meaningless, so only the active function counts).
function computeBins(): Bins {
  const fn = store.state?.function
  const ch = channel.value
  const vals = windowed.value
    .filter((r) => r.function === fn)
    .map((r) => ch.value(r))
    .filter((v) => Number.isFinite(v))
  const total = vals.length
  if (total === 0) {
    axisUnit.value = ch.axis(0).unit
    return empty()
  }

  let min = Math.min(...vals)
  let max = Math.max(...vals)
  const ax = ch.axis(Math.max(Math.abs(min), Math.abs(max)))
  axisUnit.value = ax.unit
  const mean = vals.reduce((a, b) => a + b, 0) / total
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / total)
  // All-identical readings → a narrow band so a bar is still visible.
  if (max === min) {
    const w = Math.abs(min) > 0 ? Math.abs(min) * 1e-4 : 1
    min -= w / 2
    max += w / 2
  }
  // Square-root rule for the bin count, clamped to a sensible range.
  const nBins = Math.min(50, Math.max(8, Math.ceil(Math.sqrt(total))))
  const binWidth = (max - min) / nBins
  const counts = new Array<number>(nBins).fill(0)
  for (const v of vals) {
    const idx = Math.min(nBins - 1, Math.max(0, Math.floor((v - min) / binWidth)))
    counts[idx]++
  }
  const centers = counts.map((_, i) => (min + (i + 0.5) * binWidth) / ax.div)
  return { centers, counts, lo: min, binWidth, total, mean, std, div: ax.div }
}

function buildData(): uPlot.AlignedData {
  bins = computeBins()
  return [bins.centers, bins.counts]
}

const fmt = (v: number) => {
  const f = channel.value.format(v)
  return `${f.sign}${f.text} ${f.unit}`.trim()
}

const barsPaths = uPlot.paths.bars!({ align: 0, size: [1, Infinity], gap: 1 })

// Mean (solid) and ±1σ (dashed) — the standard DMM histogram markers — plus limits.
function overlayPlugin(): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const lim = limits.value
        if (lim.enabled) {
          const bad = cssVar('--chart-limit')
          if (lim.lo != null) vLine(u, lim.lo / bins.div, bad, 1.5, [6, 4])
          if (lim.hi != null) vLine(u, lim.hi / bins.div, bad, 1.5, [6, 4])
        }
        if (!Number.isFinite(bins.mean)) return
        const meanColor = cssVar('--chart-mean')
        if (bins.std > 0) {
          vLine(u, (bins.mean - bins.std) / bins.div, meanColor, 1.5, [5, 4])
          vLine(u, (bins.mean + bins.std) / bins.div, meanColor, 1.5, [5, 4])
        }
        vLine(u, bins.mean / bins.div, meanColor, 2.5)
      },
    },
  }
}

// Hover tooltip: the bin's value range, its count, and share of the total.
function tooltipPlugin(): uPlot.Plugin {
  let t: ReturnType<typeof makeTip>
  return {
    hooks: {
      init: (u) => {
        t = makeTip(u)
      },
      setCursor: (u) => {
        const idx = u.cursor.idx
        if (idx == null || idx >= bins.counts.length) {
          t.tip.style.display = 'none'
          return
        }
        const lo = bins.lo + idx * bins.binWidth
        const count = bins.counts[idx]
        const pct = bins.total ? (count / bins.total) * 100 : 0
        t.a.textContent = `${fmt(lo)} – ${fmt(lo + bins.binWidth)}`
        t.b.textContent = `${count} (${pct.toFixed(1)}%)`
        t.tip.style.display = 'flex'
        placeTip(u, t.tip)
      },
    },
  }
}

function options(width: number): uPlot.Options {
  return {
    width,
    height: HEIGHT,
    scales: { x: { time: false }, y: { range: (_u, _min, max) => [0, Math.max(1, max)] } },
    axes: [
      themedAxis({ values: stepTicks }),
      themedAxis({
        size: 48,
        values: (_u, splits) => splits.map((v) => (Number.isInteger(v) ? String(v) : '')),
      }),
    ],
    series: [
      {},
      {
        label: 'count',
        paths: barsPaths,
        stroke: cssVar('--chart-line'),
        fill: cssVar('--chart-fill'),
        width: 1,
        points: { show: false },
      },
    ],
    cursor: { drag: { x: false, y: false }, points: { show: false } },
    legend: { show: false },
    plugins: [overlayPlugin(), tooltipPlugin()],
  }
}

function create(): void {
  if (!el.value) return
  plot?.destroy()
  plot = new uPlot(options(el.value.clientWidth || 600), buildData(), el.value)
}

onMounted(() => {
  create()
  ro = new ResizeObserver(() => {
    const w = el.value?.clientWidth ?? 0
    if (plot && w > 0) plot.setSize({ width: w, height: HEIGHT })
  })
  ro.observe(el.value!)
})

watch([windowed, channel], () => plot?.setData(buildData()))
watch(limits, () => plot?.redraw(), { deep: true })
watch(theme, create)

onBeforeUnmount(() => {
  ro?.disconnect()
  plot?.destroy()
})

function exportImage(): void {
  if (!plot) return
  const now = new Date()
  const sd = Number.isFinite(bins.std) ? ` · mean ${fmt(bins.mean)} · σ ${fmt(bins.std)}` : ''
  exportPng(
    plot,
    `${channel.value.label} — histogram (${axisUnit.value})`,
    `${bins.total} readings${sd} · ${now.toLocaleString()} · SCPI SoftPanel`,
    `scpi-histogram-${fileStamp(now)}.png`,
  )
}
defineExpose({ exportImage })
</script>

<template>
  <div class="hist">
    <span v-if="axisUnit" class="unit-tag mono">{{ axisUnit }}</span>
    <div ref="el" class="chart" />
  </div>
</template>

<style scoped>
.hist {
  position: relative;
}
.unit-tag {
  position: absolute;
  right: 8px;
  top: 2px;
  z-index: 4;
  font-size: 11px;
  font-weight: 800;
  color: var(--muted);
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--panel-2);
  border: 1px solid var(--border);
}
.chart {
  width: 100%;
  padding-top: 22px;
}
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
  font-size: 13px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.chart :deep(.tip-t) {
  font-size: 10px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
