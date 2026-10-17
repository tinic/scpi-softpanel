import { ref } from 'vue'

// View state shared between the layout, the chart panel and the keyboard shortcuts.
// Module-level singletons; the chart tab persists across reloads.

export type ChartTab = 'trend' | 'histogram' | 'meter' | 'sessions'
export const CHART_TABS: { id: ChartTab; label: string }[] = [
  { id: 'trend', label: 'Trend' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'meter', label: 'Meter' },
  { id: 'sessions', label: 'Sessions' },
]

const TAB_KEY = 'scpi.chartTab'
function loadTab(): ChartTab {
  try {
    const t = localStorage.getItem(TAB_KEY)
    return CHART_TABS.some((c) => c.id === t) ? (t as ChartTab) : 'trend'
  } catch {
    return 'trend'
  }
}

const chartTab = ref<ChartTab>(loadTab())
const bigMode = ref(false)
const helpOpen = ref(false)

export function useUi() {
  function setChartTab(t: ChartTab): void {
    chartTab.value = t
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* not persisted */
    }
  }
  return { chartTab, setChartTab, bigMode, helpOpen }
}
