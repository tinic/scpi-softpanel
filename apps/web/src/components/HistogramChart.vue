<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useMeterStore } from '@/stores/meter'
import { useChartWindow } from '@/composables/useChartWindow'
import { useTempUnit } from '@/composables/useTempUnit'
import { convertTemp, formatValue, tempUnitLabel } from '@/lib/format'

const store = useMeterStore()
const { windowed } = useChartWindow()
const { tempUnit } = useTempUnit()
const el = ref<HTMLDivElement | null>(null)

let plot: uPlot | null = null
let ro: ResizeObserver | null = null

interface Bins {
  centers: number[]
  counts: number[]
  lo: number
  binWidth: number
  total: number
  unit: string
  mean: number
  std: number
  isTemp: boolean
}
const empty = (unit = '', isTemp = false): Bins => ({
  centers: [],
  counts: [],
  lo: 0,
  binWidth: 0,
  total: 0,
  unit,
  mean: NaN,
  std: NaN,
  isTemp,
})
let bins: Bins = empty()

// Bin the current function's finite readings (mixing units across a function switch
// would be meaningless, so — like the stats strip — only the active function counts).
function computeBins(): Bins {
  const fn = store.lastReading?.function
  const isTemp = fn === 'TEMP'
  const unit = isTemp ? tempUnitLabel(tempUnit.value) : (store.lastReading?.unit ?? '')
  const vals = windowed.value
    .filter((r) => r.function === fn && Number.isFinite(r.value))
    .map((r) => (isTemp ? convertTemp(r.value, tempUnit.value) : r.value))
  const total = vals.length
  if (total === 0) return empty(unit, isTemp)

  let min = Math.min(...vals)
  let max = Math.max(...vals)
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
  const centers = counts.map((_, i) => min + (i + 0.5) * binWidth)
  return { centers, counts, lo: min, binWidth, total, unit, mean, std, isTemp }
}

function buildData(): uPlot.AlignedData {
  bins = computeBins()
  return [bins.centers, bins.counts]
}

// Compact engineering value for axis ticks / tooltip, e.g. "2.85 mV".
function fmtVal(v: number, digits = 3): string {
  // Temperature is shown at fixed resolution with no SI prefix (no "m°C").
  if (bins.isTemp) return `${v.toFixed(1)} ${bins.unit}`
  const f = formatValue(v, bins.unit, digits)
  return `${f.sign}${f.text} ${f.unit}`.trim()
}

const barsPaths = uPlot.paths.bars!({ align: 0, size: [1, Infinity], gap: 1 })

// Overlay the mean (thick) and ±1σ (thin dashed) lines — the standard DMM histogram
// statistics markers.
function statsOverlay(): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        if (!Number.isFinite(bins.mean)) return
        const ctx = u.ctx
        const top = u.bbox.top
        const bot = u.bbox.top + u.bbox.height
        const vline = (x: number, color: string, width: number, dash: number[]) => {
          const px = Math.round(u.valToPos(x, 'x', true))
          ctx.save()
          ctx.beginPath()
          ctx.strokeStyle = color
          ctx.lineWidth = width
          ctx.setLineDash(dash)
          ctx.moveTo(px, top)
          ctx.lineTo(px, bot)
          ctx.stroke()
          ctx.restore()
        }
        if (bins.std > 0) {
          vline(bins.mean - bins.std, 'rgba(124,179,255,0.55)', 2, [5, 4])
          vline(bins.mean + bins.std, 'rgba(124,179,255,0.55)', 2, [5, 4])
        }
        vline(bins.mean, '#7cb3ff', 4, [])
      },
    },
  }
}

// Hover tooltip: the bin's value range, its count, and share of the total.
function tooltipPlugin(): uPlot.Plugin {
  let tip: HTMLDivElement
  let line1: HTMLSpanElement
  let line2: HTMLSpanElement
  return {
    hooks: {
      init: (u: uPlot) => {
        tip = document.createElement('div')
        tip.className = 'tip'
        line1 = document.createElement('span')
        line1.className = 'tip-v'
        line2 = document.createElement('span')
        line2.className = 'tip-t'
        tip.append(line1, line2)
        tip.style.display = 'none'
        u.over.appendChild(tip)
      },
      setCursor: (u: uPlot) => {
        const idx = u.cursor.idx
        if (idx == null || idx >= bins.counts.length) {
          tip.style.display = 'none'
          return
        }
        const lo = bins.lo + idx * bins.binWidth
        const hi = lo + bins.binWidth
        const count = bins.counts[idx]
        const pct = bins.total ? (count / bins.total) * 100 : 0
        line1.textContent = `${fmtVal(lo)} – ${fmtVal(hi)}`
        line2.textContent = `${count} (${pct.toFixed(1)}%)`
        tip.style.display = 'flex'
        const left = u.cursor.left ?? 0
        const top = u.cursor.top ?? 0
        const w = u.over.clientWidth
        const tx = left < 80 ? '0' : left > w - 80 ? '-100%' : '-50%'
        tip.style.left = `${left}px`
        tip.style.top = `${top}px`
        tip.style.transform = `translate(${tx}, calc(-100% - 12px))`
      },
    },
  }
}

function options(width: number): uPlot.Options {
  return {
    width,
    height: 280,
    scales: { x: { time: false }, y: { range: (_u, _min, max) => [0, Math.max(1, max)] } },
    axes: [
      {
        stroke: '#8b949e',
        grid: { stroke: '#21262d', width: 1 },
        ticks: { stroke: '#30363d' },
        font: '11px ui-monospace, monospace',
        values: (_u, splits) => splits.map((v) => fmtVal(v)),
      },
      {
        stroke: '#8b949e',
        grid: { stroke: '#21262d', width: 1 },
        ticks: { stroke: '#30363d' },
        font: '11px ui-monospace, monospace',
        size: 48,
        values: (_u, splits) => splits.map((v) => (Number.isInteger(v) ? String(v) : '')),
      },
    ],
    series: [
      {},
      {
        label: 'count',
        paths: barsPaths,
        stroke: '#4ea1ff',
        fill: 'rgba(78,161,255,0.35)',
        width: 1,
        points: { show: false },
      },
    ],
    cursor: { drag: { x: false, y: false }, points: { show: false } },
    legend: { show: false },
    plugins: [statsOverlay(), tooltipPlugin()],
  }
}

onMounted(() => {
  if (!el.value) return
  const width = el.value.clientWidth || 600
  plot = new uPlot(options(width), buildData(), el.value)
  ro = new ResizeObserver(() => {
    const w = el.value?.clientWidth ?? 0
    if (plot && w > 0) plot.setSize({ width: w, height: 280 })
  })
  ro.observe(el.value)
})

watch([windowed, tempUnit], () => plot?.setData(buildData()))

onBeforeUnmount(() => {
  ro?.disconnect()
  plot?.destroy()
})
</script>

<template>
  <div ref="el" class="chart" />
</template>

<style scoped>
.chart {
  width: 100%;
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
  background: rgba(13, 17, 23, 0.95);
  border: 1px solid var(--border);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  white-space: nowrap;
}
.chart :deep(.tip-v) {
  font-family: 'Iosevka', ui-monospace, monospace;
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
