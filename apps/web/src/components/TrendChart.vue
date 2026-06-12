<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useMeterStore } from '@/stores/meter'

const store = useMeterStore()
const el = ref<HTMLDivElement | null>(null)
const WINDOW = 600

let plot: uPlot | null = null
let ro: ResizeObserver | null = null

function buildData(): uPlot.AlignedData {
  const r = store.readings.slice(-WINDOW)
  const xs = new Array<number>(r.length)
  const ys = new Array<number | null>(r.length)
  for (let i = 0; i < r.length; i++) {
    xs[i] = r[i].ts / 1000
    ys[i] = Number.isFinite(r[i].value) ? r[i].value : null
  }
  return [xs, ys]
}

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
  <div ref="el" class="chart" />
</template>

<style scoped>
.chart {
  width: 100%;
}
</style>
