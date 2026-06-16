<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { Reading } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { formatContinuity, formatValue } from '@/lib/format'

const store = useMeterStore()
const el = ref<HTMLDivElement | null>(null)
const WINDOW = 600

let plot: uPlot | null = null
let ro: ResizeObserver | null = null

// Baseline timestamp: readings before it are hidden, so advancing it clears the trend
// (same idea as the min/avg/max `statsSince` marker — purely a view filter, the ring
// itself is untouched).
const trendSince = ref(0)
// The readings currently plotted (after the filter/slice below), so the hover tooltip
// can map a point index back to its full Reading for unit-aware formatting.
let view: Reading[] = []

function buildData(): uPlot.AlignedData {
  const r = store.readings.filter((d) => d.ts >= trendSince.value).slice(-WINDOW)
  view = r
  const xs = new Array<number>(r.length)
  const ys = new Array<number | null>(r.length)
  for (let i = 0; i < r.length; i++) {
    xs[i] = r[i].ts / 1000
    ys[i] = Number.isFinite(r[i].value) ? r[i].value : null
  }
  return [xs, ys]
}

function clearTrend(): void {
  trendSince.value = store.readings.at(-1)?.ts ?? Date.now()
  plot?.setData(buildData())
}

const fmt = (r: Reading) =>
  r.function === 'CONT' ? formatContinuity(r.value) : formatValue(r.value, r.unit)

// uPlot's default tick labels round to a few significant digits, which collapses
// every label to the same string when the visible spread is tiny relative to the
// value (e.g. a few hundred µV around 5 V). Derive decimals from the tick step.
function yTickValues(
  _u: uPlot,
  splits: number[],
  _axisIdx: number,
  _space: number,
  incr: number,
): string[] {
  const decimals =
    Number.isFinite(incr) && incr > 0 ? Math.max(0, Math.min(9, Math.ceil(-Math.log10(incr)))) : 3
  return splits.map((v) => v.toFixed(decimals))
}

// A floating tooltip that follows the cursor and shows the hovered reading's value + time.
function tooltipPlugin(): uPlot.Plugin {
  let tip: HTMLDivElement
  let val: HTMLSpanElement
  let time: HTMLSpanElement
  return {
    hooks: {
      init: (u: uPlot) => {
        tip = document.createElement('div')
        tip.className = 'tip'
        val = document.createElement('span')
        val.className = 'tip-v'
        time = document.createElement('span')
        time.className = 'tip-t'
        tip.append(val, time)
        tip.style.display = 'none'
        u.over.appendChild(tip)
      },
      setCursor: (u: uPlot) => {
        const idx = u.cursor.idx
        const r = idx == null ? undefined : view[idx]
        if (!r) {
          tip.style.display = 'none'
          return
        }
        const f = fmt(r)
        val.textContent = `${f.sign}${f.text} ${f.unit}`.trim()
        time.textContent = new Date(r.ts).toLocaleTimeString()
        tip.style.display = 'flex'
        const left = u.cursor.left ?? 0
        const top = u.cursor.top ?? 0
        const w = u.over.clientWidth
        // Center the tip above the point, flipping near the edges so it stays in view.
        const tx = left < 70 ? '0' : left > w - 70 ? '-100%' : '-50%'
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
    scales: { x: { time: true } },
    axes: [
      {
        stroke: '#8b949e',
        grid: { stroke: '#21262d', width: 1 },
        ticks: { stroke: '#30363d' },
        font: '11px ui-monospace, monospace',
      },
      {
        stroke: '#8b949e',
        grid: { stroke: '#21262d', width: 1 },
        ticks: { stroke: '#30363d' },
        font: '11px ui-monospace, monospace',
        values: yTickValues,
        size: 64,
      },
    ],
    series: [{}, { label: 'value', stroke: '#4ea1ff', width: 1.5, points: { show: false } }],
    cursor: { drag: { x: true, y: false } },
    legend: { show: false },
    plugins: [tooltipPlugin()],
  }
}

onMounted(() => {
  if (!el.value) return
  const width = el.value.clientWidth || 600
  plot = new uPlot(options(width), buildData(), el.value)
  ro = new ResizeObserver(() => {
    // Skip zero-width (e.g. while collapsed) so the chart restores cleanly on expand.
    const w = el.value?.clientWidth ?? 0
    if (plot && w > 0) plot.setSize({ width: w, height: 280 })
  })
  ro.observe(el.value)
})

watch(
  () => store.readings,
  () => plot?.setData(buildData()),
)

onBeforeUnmount(() => {
  ro?.disconnect()
  plot?.destroy()
})
</script>

<template>
  <div class="trend">
    <button class="clear" title="Clear trend" @click="clearTrend">↺</button>
    <div ref="el" class="chart" />
  </div>
</template>

<style scoped>
.trend {
  position: relative;
  width: 100%;
}
.chart {
  width: 100%;
}
.clear {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 14px;
  line-height: 1;
  color: var(--muted);
  opacity: 0.7;
}
.clear:hover {
  color: var(--text);
  opacity: 1;
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
  background: rgba(13, 17, 23, 0.95);
  border: 1px solid var(--border);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  white-space: nowrap;
}
.chart :deep(.tip-v) {
  font-family: 'Iosevka', ui-monospace, monospace;
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
</style>
