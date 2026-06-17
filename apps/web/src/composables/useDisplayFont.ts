import { ref } from 'vue'

// Font for the big measurement readout (and the min/avg/max stats). Frontend-only
// preference; module-level singleton + localStorage so it is shared and persists.
// Each stack falls back to Iosevka then a generic monospace for glyphs the chosen
// face lacks (e.g. Ω/µ in the segment fonts).

export type DisplayFont = 'iosevka' | 'dseg7' | 'dseg14' | 'oxanium'

export interface DisplayFontInfo {
  label: string
  /** CSS font-family stack. */
  stack: string
  /** Weight to request (matches the embedded face). */
  weight: number
}

export const DISPLAY_FONTS: Record<DisplayFont, DisplayFontInfo> = {
  iosevka: { label: 'Iosevka', stack: "'Iosevka', ui-monospace, monospace", weight: 800 },
  dseg7: { label: 'DSEG7', stack: "'DSEG7', 'Iosevka', ui-monospace, monospace", weight: 700 },
  dseg14: { label: 'DSEG14', stack: "'DSEG14', 'Iosevka', ui-monospace, monospace", weight: 700 },
  oxanium: {
    label: 'Oxanium',
    stack: "'Oxanium', 'Iosevka', ui-monospace, monospace",
    weight: 700,
  },
}

const KEY = 'scpi.displayFont'
const VALID = Object.keys(DISPLAY_FONTS) as DisplayFont[]
const stored = localStorage.getItem(KEY) as DisplayFont | null
const displayFont = ref<DisplayFont>(stored && VALID.includes(stored) ? stored : 'iosevka')

export function useDisplayFont() {
  function setDisplayFont(f: DisplayFont): void {
    displayFont.value = f
    localStorage.setItem(KEY, f)
  }
  return { displayFont, setDisplayFont, fonts: DISPLAY_FONTS }
}
