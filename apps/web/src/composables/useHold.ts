import { ref } from 'vue'
import type { Reading } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'

// Display hold: freeze the readout on the reading at the moment of pressing, like a
// DMM's HOLD key. Acquisition, charts and logging keep running underneath.
const held = ref<Reading | null>(null)

export function useHold() {
  const store = useMeterStore()
  function toggle(): void {
    held.value = held.value ? null : store.lastReading
  }
  function release(): void {
    held.value = null
  }
  return { held, toggle, release }
}
