import { onBeforeUnmount, onMounted } from 'vue'
import { FUNCTION_INFO, type MeterFunction } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { useHold } from '@/composables/useHold'
import { useStats } from '@/composables/useStats'
import { CHART_TABS, useUi } from '@/composables/useUi'

/**
 * Front-panel-style keyboard control. Letters pick functions the way the keys are
 * labelled on a bench DMM (V, A, Ω→R, …; Shift for the AC / 4-wire / period
 * variant), arrows step the range. Ignored while typing in a field.
 */

const FN_KEYS: Record<string, MeterFunction> = {
  v: 'VOLT:DC',
  V: 'VOLT:AC',
  a: 'CURR:DC',
  A: 'CURR:AC',
  r: 'RES',
  R: 'FRES',
  c: 'CAP',
  f: 'FREQ',
  F: 'PER',
  o: 'CONT',
  d: 'DIOD',
  t: 'TEMP',
}

export const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; desc: string }[] }[] = [
  {
    title: 'Function',
    items: [
      { keys: ['V'], desc: 'DC voltage  ·  ⇧V AC voltage' },
      { keys: ['A'], desc: 'DC current  ·  ⇧A AC current' },
      { keys: ['R'], desc: 'Resistance 2-wire  ·  ⇧R 4-wire' },
      { keys: ['C'], desc: 'Capacitance' },
      { keys: ['F'], desc: 'Frequency  ·  ⇧F period' },
      { keys: ['O'], desc: 'Continuity' },
      { keys: ['D'], desc: 'Diode' },
      { keys: ['T'], desc: 'Temperature' },
    ],
  },
  {
    title: 'Measurement',
    items: [
      { keys: ['↑', '↓'], desc: 'Range up / down (locks the range)' },
      { keys: ['U'], desc: 'Autorange' },
      { keys: ['Space'], desc: 'Run / stop acquisition' },
      { keys: ['M'], desc: 'Measure once' },
      { keys: ['Z'], desc: 'Relative: tare / clear' },
      { keys: ['H'], desc: 'Hold the display' },
      { keys: ['X'], desc: 'Reset statistics' },
      { keys: ['K'], desc: 'Drop a marker on the trend' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: ['1', '–', '4'], desc: 'Trend · Histogram · Meter · Sessions' },
      { keys: ['B'], desc: 'Big digits (full screen)' },
      { keys: ['?'], desc: 'This help' },
      { keys: ['Esc'], desc: 'Close overlay' },
    ],
  },
]

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

export function useShortcuts(): void {
  const store = useMeterStore()
  const hold = useHold()
  const stats = useStats()
  const ui = useUi()

  function stepRange(dir: 1 | -1): void {
    const fn = store.state?.function
    const ranges = fn ? FUNCTION_INFO[fn].ranges : null
    if (!ranges) return
    const st = store.state!
    let idx: number
    if (st.autoRange === false && st.range && st.range !== 'AUTO') {
      idx = ranges.indexOf(Number(st.range))
      if (idx < 0) idx = 0
      idx = Math.max(0, Math.min(ranges.length - 1, idx + dir))
    } else {
      // From autorange, lock onto the range that holds the present reading.
      const v = Math.abs(store.lastReading?.value ?? 0)
      idx = ranges.findIndex((r) => r >= v)
      if (idx < 0) idx = ranges.length - 1
    }
    store.setRange(String(ranges[idx]))
  }

  function tare(): void {
    const st = store.state
    if (!st?.function || !FUNCTION_INFO[st.function].sense) return
    if (st.nullEnabled) {
      store.setNull(false, 0)
      return
    }
    const cur = store.lastReading?.value
    if (cur != null && Number.isFinite(cur)) store.setNull(true, cur)
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (ui.helpOpen.value) ui.helpOpen.value = false
      else if (ui.bigMode.value) ui.bigMode.value = false
      return
    }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
    // Space/Enter on a focused button presses that button, not a shortcut.
    if ((e.key === ' ' || e.key === 'Enter') && (e.target as HTMLElement)?.closest('button, a'))
      return

    const fn = FN_KEYS[e.key]
    if (fn) {
      store.setFunction(fn)
    } else if (e.key >= '1' && e.key <= String(CHART_TABS.length)) {
      ui.setChartTab(CHART_TABS[Number(e.key) - 1].id)
    } else {
      switch (e.key) {
        case 'ArrowUp':
          stepRange(1)
          break
        case 'ArrowDown':
          stepRange(-1)
          break
        case 'u':
          store.setAutoRange(true)
          break
        case ' ':
          store.setPolling(!(store.state?.polling ?? false))
          break
        case 'm':
          store.measureOnce()
          break
        case 'z':
          tare()
          break
        case 'h':
          hold.toggle()
          break
        case 'x':
          stats.reset()
          break
        case 'k':
          store.addMarker('')
          break
        case 'b':
          ui.bigMode.value = !ui.bigMode.value
          break
        case '?':
          ui.helpOpen.value = !ui.helpOpen.value
          break
        default:
          return
      }
    }
    e.preventDefault()
  }

  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}
