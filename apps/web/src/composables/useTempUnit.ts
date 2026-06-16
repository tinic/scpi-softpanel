import { ref } from 'vue'
import type { TempUnit } from '@/lib/format'

// Temperature display unit is a frontend-only preference: the meter always reports °C
// and the app converts (°F/K) in software. Module-level singleton + localStorage so it
// is shared and persists across reloads.
const KEY = 'scpi.tempUnit'
const VALID: TempUnit[] = ['C', 'F', 'K']
const stored = localStorage.getItem(KEY) as TempUnit | null
const tempUnit = ref<TempUnit>(stored && VALID.includes(stored) ? stored : 'C')

export function useTempUnit() {
  function setTempUnit(u: TempUnit): void {
    tempUnit.value = u
    localStorage.setItem(KEY, u)
  }
  return { tempUnit, setTempUnit }
}
