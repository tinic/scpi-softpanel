import { computed, ref } from 'vue'
import { useMeterStore } from '@/stores/meter'

// Module-level singleton so the Trend and Histogram tabs share one Clear baseline —
// they are two views of the same data window. Advancing `since` hides everything
// before it (a pure view filter; the store ring is untouched).
const since = ref(0)

export function useChartWindow() {
  const store = useMeterStore()
  /** Readings since the last Clear (the store ring is already capacity-capped). */
  const windowed = computed(() => store.readings.filter((r) => r.ts >= since.value))
  function clear(): void {
    since.value = store.readings.at(-1)?.ts ?? Date.now()
  }
  return { windowed, clear }
}
