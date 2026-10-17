<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { SessionData, SessionMeta } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { useUi } from '@/composables/useUi'
import { cssVar, useTheme } from '@/composables/useTheme'
import {
  axisScale,
  formatDuration,
  formatValue,
  functionUnitSuffix,
  stepDecimals,
} from '@/lib/format'
import {
  canvasLabel,
  exportPng,
  fileStamp,
  makeTip,
  placeTip,
  stepTicks,
  themedAxis,
  vLine,
} from '@/lib/chart'
import UiIcon from './UiIcon.vue'

/**
 * Recorded sessions: the list of what's on disk, and a viewer for one session with
 * an optional second one overlaid (aligned by elapsed time — e.g. before/after a
 * fix, two burn-in runs). Long sessions arrive min/max-decimated from the server,
 * so spikes and dropouts survive.
 */

const store = useMeterStore()
const { chartTab } = useUi()
const { resolved: theme } = useTheme()

const sessions = ref<SessionMeta[]>([])
const loading = ref(false)
const error = ref('')
const primary = shallowRef<SessionData | null>(null)
const compare = shallowRef<SessionData | null>(null)
const confirmDelete = ref<string | null>(null)

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    sessions.value = await store.listSessions()
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
watch(
  () => chartTab.value === 'sessions',
  (on) => on && refresh(),
)
// The list changes when a recording starts/stops.
watch(
  () => store.state?.recording?.id,
  () => setTimeout(refresh, 300),
)

const recordingId = computed(() => store.state?.recording?.id ?? null)

async function view(id: string): Promise<void> {
  error.value = ''
  try {
    primary.value = await store.getSession(id)
    if (compare.value?.meta.id === id) compare.value = null
  } catch (e) {
    error.value = String(e)
  }
}
async function overlay(id: string): Promise<void> {
  error.value = ''
  try {
    compare.value = compare.value?.meta.id === id ? null : await store.getSession(id)
  } catch (e) {
    error.value = String(e)
  }
}
async function remove(id: string): Promise<void> {
  if (confirmDelete.value !== id) {
    confirmDelete.value = id
    setTimeout(() => confirmDelete.value === id && (confirmDelete.value = null), 3000)
    return
  }
  confirmDelete.value = null
  try {
    await store.deleteSession(id)
    if (primary.value?.meta.id === id) primary.value = null
    if (compare.value?.meta.id === id) compare.value = null
    await refresh()
  } catch (e) {
    error.value = String(e)
  }
}

function lengthOf(m: SessionMeta): number {
  const end = m.ended ?? (m.id === recordingId.value ? Date.now() : null)
  return end == null ? NaN : end - m.started
}
function fmtStart(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// -- viewer chart -------------------------------------------------------------
const el = ref<HTMLDivElement | null>(null)
let plot: uPlot | null = null
let ro: ResizeObserver | null = null
const HEIGHT = 300

/** Display unit for a session's base unit + function ("V" + VOLT:DC → "VDC"). */
function unitOf(d: SessionData): { base: string; suffix: string; si: boolean } {
  const si = d.function !== 'TEMP' && d.function !== 'CONT'
  return { base: d.unit, suffix: functionUnitSuffix(d.function), si }
}
function scaleFor(d: SessionData): { div: number; unit: string } {
  const u = unitOf(d)
  if (!u.si) return { div: 1, unit: u.base }
  let maxAbs = 0
  for (const v of d.values) if (v != null && Math.abs(v) > maxAbs) maxAbs = Math.abs(v)
  const a = axisScale(maxAbs, u.base)
  return { div: a.div, unit: a.unit + u.suffix }
}
function fmtVal(d: SessionData, v: number): string {
  const u = unitOf(d)
  if (!u.si) return `${v.toFixed(d.function === 'TEMP' ? 1 : 3)} ${u.base}`
  const f = formatValue(v, u.base)
  return `${f.sign}${f.text} ${f.unit}${u.suffix}`
}

const sameUnits = computed(
  () =>
    !compare.value ||
    (primary.value &&
      unitOf(compare.value).base === unitOf(primary.value).base &&
      compare.value.function === primary.value.function),
)

let sA = { div: 1, unit: '' }
const unitA = computed(() => (primary.value ? scaleFor(primary.value).unit : ''))
let sB = { div: 1, unit: '' }

function buildData(): uPlot.AlignedData {
  const a = primary.value!
  sA = scaleFor(a)
  const tableA: uPlot.AlignedData = [
    a.ts.map((t) => (t - a.meta.started) / 1000),
    a.values.map((v) => (v == null ? null : v / sA.div)),
  ]
  const b = compare.value
  if (!b) return tableA
  sB = sameUnits.value ? sA : scaleFor(b)
  const tableB: uPlot.AlignedData = [
    b.ts.map((t) => (t - b.meta.started) / 1000),
    b.values.map((v) => (v == null ? null : v / sB.div)),
  ]
  // Real nulls (overload) stay gaps; alignment holes are spanned.
  return uPlot.join(
    [tableA, tableB],
    [
      [0, 1],
      [0, 1],
    ],
  )
}

// Elapsed time since the session start: "1:05:00", "4:30", or "2.5 s" for short spans.
function elapsedTicks(
  _u: uPlot,
  splits: number[],
  _ax: number,
  _space: number,
  incr: number,
): string[] {
  if (incr < 1) return splits.map((s) => `${s.toFixed(stepDecimals(incr))} s`)
  return splits.map((s) => formatDuration(s * 1000).replace(/^0:/, ''))
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
        const a = primary.value
        if (idx == null || !a) {
          t.tip.style.display = 'none'
          return
        }
        const x = u.data[0][idx]
        const ya = u.data[1][idx]
        const yb = compare.value ? u.data[2]?.[idx] : undefined
        const parts: string[] = []
        if (ya != null) parts.push(fmtVal(a, ya * sA.div))
        if (yb != null && compare.value) parts.push(`▲ ${fmtVal(compare.value, yb * sB.div)}`)
        if (!parts.length) {
          t.tip.style.display = 'none'
          return
        }
        t.a.textContent = parts.join('   ')
        t.b.textContent = `+${formatDuration(x * 1000)} · ${new Date(a.meta.started + x * 1000).toLocaleTimeString()}`
        t.tip.style.display = 'flex'
        placeTip(u, t.tip)
      },
    },
  }
}

function markerPlugin(): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const a = primary.value
        if (!a) return
        const mk = cssVar('--chart-marker')
        for (const m of a.meta.markers) {
          const px = vLine(u, (m.ts - a.meta.started) / 1000, mk, 1.25, [3, 3])
          if (px != null) canvasLabel(u, m.text || '⚑', px, mk)
        }
      },
    },
  }
}

function options(width: number): uPlot.Options {
  const twoScales = !!compare.value && !sameUnits.value
  const series: uPlot.Series[] = [
    {},
    { label: 'A', stroke: cssVar('--chart-line'), width: 1.25, points: { show: false } },
  ]
  if (compare.value) {
    series.push({
      label: 'B',
      stroke: cssVar('--chart-compare'),
      width: 1.25,
      points: { show: false },
      scale: twoScales ? 'y2' : 'y',
    })
  }
  const axes: uPlot.Axis[] = [
    themedAxis({ values: elapsedTicks }),
    themedAxis({ values: stepTicks, size: 70 }),
  ]
  if (twoScales)
    axes.push(
      themedAxis({ scale: 'y2', side: 1, values: stepTicks, size: 70, grid: { show: false } }),
    )
  return {
    width,
    height: HEIGHT,
    scales: { x: { time: false } },
    axes,
    series,
    cursor: { drag: { x: true, y: false }, points: { size: 6 } },
    legend: { show: false },
    plugins: [tooltipPlugin(), markerPlugin()],
  }
}

async function draw(): Promise<void> {
  plot?.destroy()
  plot = null
  if (!primary.value) return
  await nextTick()
  if (!el.value) return
  const data = buildData()
  plot = new uPlot(options(el.value.clientWidth || 600), data, el.value)
}

watch([primary, compare, theme], draw)

onMounted(() => {
  ro = new ResizeObserver(() => {
    const w = el.value?.clientWidth ?? 0
    if (plot && w > 0) plot.setSize({ width: w, height: HEIGHT })
  })
  watch(
    el,
    (e, old) => {
      if (old) ro?.unobserve(old)
      if (e) ro?.observe(e)
    },
    { immediate: true },
  )
})
onBeforeUnmount(() => {
  ro?.disconnect()
  plot?.destroy()
})

const summary = computed(() => {
  const a = primary.value
  if (!a) return null
  let min = Infinity
  let max = -Infinity
  let ol = 0
  for (const v of a.values) {
    if (v == null) ol++
    else {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return {
    min: Number.isFinite(min) ? fmtVal(a, min) : '—',
    max: Number.isFinite(max) ? fmtVal(a, max) : '—',
    ol,
  }
})

function exportImage(): void {
  const a = primary.value
  if (!plot || !a) return
  const b = compare.value
  exportPng(
    plot,
    `${a.meta.name}${b ? `  vs  ${b.meta.name}` : ''} (${unitA.value})`,
    `${a.total.toLocaleString()} readings · started ${new Date(a.meta.started).toLocaleString()} · SCPI SoftPanel`,
    `scpi-session-${a.meta.id}-${fileStamp()}.png`,
  )
}
defineExpose({ exportImage })
</script>

<template>
  <div class="sessions">
    <div v-if="primary" class="viewer">
      <div class="vhead">
        <div class="vtitle">
          <span class="swatch a" />
          <strong>{{ primary.meta.name }}</strong>
          <span class="muted mono">{{ primary.function }} · {{ unitA }}</span>
          <template v-if="compare">
            <span class="swatch b" />
            <strong>{{ compare.meta.name }}</strong>
            <span v-if="!sameUnits" class="muted mono">{{ compare.function }} · right axis</span>
            <button class="ghost icon sm" title="Remove overlay" @click="compare = null">
              <UiIcon name="close" :size="13" />
            </button>
          </template>
        </div>
        <button
          class="ghost icon"
          title="Close viewer"
          @click="((primary = null), (compare = null))"
        >
          <UiIcon name="close" :size="15" />
        </button>
      </div>
      <div v-if="summary" class="vstats">
        <span
          ><b class="mono">{{ primary.total.toLocaleString() }}</b> readings</span
        >
        <span
          >min <b class="mono">{{ summary.min }}</b></span
        >
        <span
          >max <b class="mono">{{ summary.max }}</b></span
        >
        <span v-if="summary.ol"
          ><b class="mono">{{ summary.ol }}</b> overload</span
        >
        <span v-if="primary.ts.length < primary.total" class="muted">
          shown as {{ primary.ts.length.toLocaleString() }} min/max points
        </span>
      </div>
      <div ref="el" class="chart" />
    </div>

    <div class="list-head">
      <span class="eyebrow">On disk</span>
      <button class="ghost icon" title="Refresh" @click="refresh">
        <UiIcon name="refresh" :size="14" />
      </button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="!store.state?.recordingAvailable" class="empty">
      Recording isn't configured on this server (no data directory).
    </p>
    <p v-else-if="!sessions.length && !loading" class="empty">
      No recordings yet. Use <b>Record to disk</b> in the Logging panel to capture a session that
      outlives the live buffer.
    </p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Started</th>
            <th class="num">Length</th>
            <th class="num">Readings</th>
            <th>Function</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in sessions"
            :key="s.id"
            :class="{ sel: primary?.meta.id === s.id, cmp: compare?.meta.id === s.id }"
          >
            <td>
              <div class="name">
                <span class="nm" :title="s.name">{{ s.name }}</span>
                <span v-if="s.id === recordingId" class="tag rec">REC</span>
                <span
                  v-else-if="s.ended == null"
                  class="tag warn"
                  title="The app stopped mid-session"
                >
                  interrupted
                </span>
                <span
                  v-if="s.markers.length"
                  class="tag"
                  :title="s.markers.map((m) => m.text).join('\n')"
                >
                  ⚑ {{ s.markers.length }}
                </span>
              </div>
            </td>
            <td class="muted">{{ fmtStart(s.started) }}</td>
            <td class="num mono">
              {{ Number.isNaN(lengthOf(s)) ? '—' : formatDuration(lengthOf(s)) }}
            </td>
            <td class="num mono">{{ s.count.toLocaleString() }}</td>
            <td class="mono muted">{{ s.functions.join(', ') || '—' }}</td>
            <td>
              <div class="acts">
                <button class="ghost icon" title="View" @click="view(s.id)">
                  <UiIcon name="eye" :size="15" />
                </button>
                <button
                  class="ghost icon"
                  :disabled="!primary || primary.meta.id === s.id"
                  :class="{ on: compare?.meta.id === s.id }"
                  title="Overlay on the open session"
                  @click="overlay(s.id)"
                >
                  <UiIcon name="layers" :size="15" />
                </button>
                <a
                  class="icon-link"
                  :href="`/api/sessions/${s.id}/csv`"
                  :download="`${s.name}.csv`"
                  title="Download CSV"
                >
                  <UiIcon name="download" :size="15" />
                </a>
                <button
                  class="ghost icon del"
                  :class="{ confirm: confirmDelete === s.id }"
                  :disabled="s.id === recordingId"
                  :title="confirmDelete === s.id ? 'Click again to delete' : 'Delete'"
                  @click="remove(s.id)"
                >
                  <UiIcon name="trash" :size="15" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.sessions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.viewer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.vhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.vtitle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.swatch {
  width: 14px;
  height: 3px;
  border-radius: 2px;
}
.swatch.a {
  background: var(--chart-line);
}
.swatch.b {
  background: var(--chart-compare);
  margin-left: 10px;
}
.vstats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  font-size: 12px;
  color: var(--muted);
}
.vstats b {
  color: var(--text);
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.sm {
  width: 22px;
  height: 22px;
}
.chart {
  width: 100%;
}
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.empty,
.err {
  margin: 4px 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}
.err {
  color: var(--bad);
}
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  text-align: left;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
tr.sel td {
  background: var(--accent-soft);
}
tr.cmp td {
  background: color-mix(in srgb, var(--chart-compare) 10%, transparent);
}
.num {
  text-align: right;
}
.name {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 280px;
}
.nm {
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
.tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--panel-3);
  color: var(--muted);
}
.tag.rec {
  background: var(--rec);
  color: #fff;
}
.tag.warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.acts {
  display: flex;
  gap: 2px;
  justify-content: flex-end;
}
.acts .icon {
  width: 28px;
  height: 28px;
}
.acts .on {
  color: var(--chart-compare);
}
.icon-link {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--muted);
}
.icon-link:hover {
  background: var(--panel-3);
  color: var(--text);
}
.del.confirm {
  color: #fff;
  background: var(--bad);
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
  white-space: pre;
}
.chart :deep(.tip-t) {
  font-size: 10px;
  color: var(--muted);
}
</style>
