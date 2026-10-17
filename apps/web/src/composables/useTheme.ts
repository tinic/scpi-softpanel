import { computed, ref } from 'vue'

// Color theme. 'system' follows the OS; the resolved theme is written to
// <html data-theme> (the CSS tokens key off it). Module-level singleton applied at
// import time, so the first paint is already in the right theme.

export type ThemePref = 'system' | 'dark' | 'light'

const KEY = 'scpi.theme'
const media = window.matchMedia('(prefers-color-scheme: light)')

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'light' ? v : 'system'
  } catch {
    return 'system'
  }
}

const pref = ref<ThemePref>(readPref())
const systemLight = ref(media.matches)
media.addEventListener('change', (e) => {
  systemLight.value = e.matches
  apply()
})

const resolved = computed<'dark' | 'light'>(() =>
  pref.value === 'system' ? (systemLight.value ? 'light' : 'dark') : pref.value,
)

function apply(): void {
  document.documentElement.dataset.theme = resolved.value
}
apply()

/** Read a CSS custom property's current value (charts draw on canvas, so they need
 *  concrete colors rather than var() references). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function useTheme() {
  function setTheme(p: ThemePref): void {
    pref.value = p
    try {
      localStorage.setItem(KEY, p)
    } catch {
      /* private mode: preference just won't persist */
    }
    apply()
  }
  /** Cycle system → dark → light. */
  function cycle(): void {
    setTheme(pref.value === 'system' ? 'dark' : pref.value === 'dark' ? 'light' : 'system')
  }
  return { pref, resolved, setTheme, cycle }
}
