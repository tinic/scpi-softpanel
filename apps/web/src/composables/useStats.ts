import { computed, ref } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { useDisplay } from '@/composables/useDisplay'
import { isStable, STABLE_COUNT, summarize } from '@/lib/stats'

// Statistics window + stability preference. Module-level singletons: the readout's
// stats strip, the big-digits view, and the shortcut handler share one baseline.
const since = ref(0)

const TOL_KEY = 'scpi.stableTolPct'
/** Stability tolerance choices, in percent of the reading. */
export const STABLE_TOLERANCES = [0.01, 0.05, 0.1, 0.5, 1]
function loadTol(): number {
  try {
    const v = Number(localStorage.getItem(TOL_KEY))
    return STABLE_TOLERANCES.includes(v) ? v : 0.1
  } catch {
    return 0.1
  }
}
const stableTolPct = ref(loadTol())

export function useStats() {
  const store = useMeterStore()
  const { channel } = useDisplay()

  /** This function's readings since the last reset (a function switch would mix units). */
  const window = computed(() => {
    const fn = store.state?.function
    return store.readings.filter((r) => r.function === fn && r.ts >= since.value)
  })

  const summary = computed(() => {
    const ch = channel.value
    return summarize(window.value.map((r) => ch.value(r)))
  })

  /** Seconds covered by the window. */
  const span = computed(() => {
    const w = window.value
    return w.length > 1 ? (w[w.length - 1].ts - w[0].ts) / 1000 : 0
  })

  /** The last few raw readings agree within tolerance (independent of the reset). */
  const stable = computed(() => {
    const fn = store.state?.function
    if (!fn || fn === 'CONT') return null
    const recent: number[] = []
    const rs = store.readings
    for (let i = rs.length - 1; i >= 0 && recent.length < STABLE_COUNT; i--) {
      if (rs[i].function !== fn) break
      recent.unshift(rs[i].value)
    }
    if (recent.length < STABLE_COUNT) return null
    return isStable(recent, stableTolPct.value / 100)
  })

  function reset(): void {
    since.value = store.lastReading?.ts ?? Date.now()
  }

  function setStableTol(pct: number): void {
    stableTolPct.value = pct
    try {
      localStorage.setItem(TOL_KEY, String(pct))
    } catch {
      /* not persisted */
    }
  }

  return { window, summary, span, stable, reset, stableTolPct, setStableTol }
}
