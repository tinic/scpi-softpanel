import { computed, ref } from 'vue'
import type { MeterFunction } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { DEFAULT_MATH, mathApplies, type MathConfig } from '@/lib/math'

// Math configuration is per measurement function (a shunt scaling set up on DCV must
// not follow you to Ω), frontend-only, and persisted. Module-level singleton.
const KEY = 'scpi.math'

function load(): Partial<Record<MeterFunction, MathConfig>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

const byFn = ref<Partial<Record<MeterFunction, MathConfig>>>(load())

export function useMath() {
  const store = useMeterStore()
  const fn = computed(() => store.state?.function ?? null)

  /** The current function's math settings (defaults when never configured). */
  const config = computed<MathConfig>(() => ({
    ...DEFAULT_MATH,
    ...(fn.value ? byFn.value[fn.value] : undefined),
  }))
  /** Math is on and meaningful for the current function. */
  const active = computed(() => mathApplies(config.value.mode, fn.value))

  function update(patch: Partial<MathConfig>): void {
    if (!fn.value) return
    byFn.value = { ...byFn.value, [fn.value]: { ...config.value, ...patch } }
    try {
      localStorage.setItem(KEY, JSON.stringify(byFn.value))
    } catch {
      /* not persisted */
    }
  }

  return { config, active, update }
}
