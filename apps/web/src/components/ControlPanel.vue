<script setup lang="ts">
import { computed } from 'vue'
import {
  AC_BANDWIDTHS,
  FREQ_APERTURES,
  FUNCTION_INFO,
  METER_FUNCTIONS,
  NPLC_CHOICES,
} from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { formatRangeLabel, formatValue } from '@/lib/format'
import { useTempUnit } from '@/composables/useTempUnit'
import type { TempUnit } from '@/lib/format'
import FunctionGlyph from './FunctionGlyph.vue'

const store = useMeterStore()
const { tempUnit, setTempUnit } = useTempUnit()
const TEMP_UNITS: { id: TempUnit; label: string }[] = [
  { id: 'C', label: '°C' },
  { id: 'F', label: '°F' },
  { id: 'K', label: 'K' },
]

const functions = METER_FUNCTIONS
const currentInfo = computed(() =>
  store.state?.function ? FUNCTION_INFO[store.state.function] : null,
)
const connected = computed(() => store.instrumentConnected)

// Keyboard shortcut shown in each key's tooltip (see useShortcuts).
const FN_KEYS: Record<string, string> = {
  'VOLT:DC': 'V',
  'VOLT:AC': '⇧V',
  'CURR:DC': 'A',
  'CURR:AC': '⇧A',
  RES: 'R',
  FRES: '⇧R',
  CAP: 'C',
  FREQ: 'F',
  PER: '⇧F',
  CONT: 'O',
  DIOD: 'D',
  TEMP: 'T',
}

// Continuity beep threshold presets; the meter accepts 0–2000 Ω (default 50)
// and resets to the default on every function change.
const CONT_THRESHOLDS = [1, 10, 50, 100, 500, 1000]

/** Poll interval choices (ms). The meter's NPLC still bounds the real rate. */
const INTERVALS = [100, 250, 500, 1000, 2000, 5000, 10000]
const intervalLabel = (ms: number) => (ms < 1000 ? `${ms} ms` : `${ms / 1000} s`)

// "V ⎓" -> letter + enlarged symbol; "Ω 2W", "Hz", "⊣⊢" render as-is.
function splitShort(s: string): { pre: string; sym: string | null } {
  const m = /^([A-Za-z]+) (\W+)$/.exec(s)
  return m ? { pre: m[1], sym: m[2] } : { pre: s, sym: null }
}

const autoRange = computed(() => store.state?.autoRange ?? false)
const activeRange = computed(() => {
  const r = store.state?.range
  return r && r !== 'AUTO' ? Number.parseFloat(r) : null
})

const isAc = computed(
  () => store.state?.function === 'VOLT:AC' || store.state?.function === 'CURR:AC',
)
const isFreqLike = computed(
  () => store.state?.function === 'FREQ' || store.state?.function === 'PER',
)
const apertureLabel = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s} s`)

// Relative/Null applies to any function with a SENSe subsystem (not CONT/DIOD).
const supportsNull = computed(() => !!currentInfo.value?.sense)
const nullEnabled = computed(() => store.state?.nullEnabled ?? false)
const nullOffset = computed(() => {
  const v = store.state?.nullValue
  if (v == null || !currentInfo.value) return ''
  const f = formatValue(v, currentInfo.value.unit)
  return `${f.sign}${f.text} ${f.unit}`
})

function tare() {
  const cur = store.lastReading?.value
  if (cur == null || !Number.isFinite(cur)) return
  // Offset that zeroes the current reading. When relative is already on, the live
  // value is itself relative, so add the existing offset back to recover the absolute.
  const base = nullEnabled.value ? (store.state?.nullValue ?? 0) : 0
  store.setNull(true, base + cur)
}

const polling = computed(() => store.state?.polling ?? false)
</script>

<template>
  <div class="controls" :class="{ offline: !connected }">
    <div class="keys fn-keys" role="group" aria-label="Function">
      <button
        v-for="fn in functions"
        :key="fn"
        class="key"
        :title="`${FUNCTION_INFO[fn].label}  (${FN_KEYS[fn]})`"
        :class="{ on: store.state?.function === fn }"
        :aria-pressed="store.state?.function === fn"
        @click="store.setFunction(fn)"
      >
        <FunctionGlyph v-if="fn === 'CONT' || fn === 'DIOD'" :fn="fn" />
        <template v-else-if="splitShort(FUNCTION_INFO[fn].short).sym"
          >{{ splitShort(FUNCTION_INFO[fn].short).pre
          }}<span class="sym">{{ splitShort(FUNCTION_INFO[fn].short).sym }}</span></template
        >
        <template v-else>{{ FUNCTION_INFO[fn].short }}</template>
      </button>
    </div>

    <div v-if="currentInfo?.ranges" class="field">
      <span class="lbl">Range <kbd>↑</kbd><kbd>↓</kbd> <kbd>U</kbd></span>
      <div class="keys range-keys">
        <button class="key" :class="{ on: autoRange }" @click="store.setAutoRange(true)">
          Auto
        </button>
        <button
          v-for="r in currentInfo.ranges"
          :key="r"
          class="key"
          :class="{ on: !autoRange && activeRange === r }"
          @click="store.setRange(String(r))"
        >
          {{ formatRangeLabel(r, currentInfo.unit) }}
        </button>
      </div>
    </div>

    <div class="pair">
      <div v-if="currentInfo?.supportsNplc" class="field">
        <span class="lbl">NPLC</span>
        <div class="segmented">
          <button
            v-for="p in NPLC_CHOICES"
            :key="p"
            :class="{ on: store.state?.nplc === p }"
            @click="store.setNplc(p)"
          >
            {{ p }}
          </button>
        </div>
      </div>

      <div v-if="isAc" class="field">
        <span class="lbl">AC filter</span>
        <div class="segmented">
          <button
            v-for="b in AC_BANDWIDTHS"
            :key="b"
            :class="{ on: store.state?.acBandwidth === b }"
            @click="store.setAcBandwidth(b)"
          >
            {{ b }} Hz
          </button>
        </div>
      </div>

      <div v-if="isFreqLike" class="field">
        <span class="lbl">Gate time</span>
        <div class="segmented">
          <button
            v-for="a in FREQ_APERTURES"
            :key="a"
            :class="{ on: store.state?.freqAperture === a }"
            @click="store.setFreqAperture(a)"
          >
            {{ apertureLabel(a) }}
          </button>
        </div>
      </div>

      <div v-if="store.state?.function === 'TEMP'" class="field">
        <span class="lbl">Unit</span>
        <div class="segmented">
          <button
            v-for="u in TEMP_UNITS"
            :key="u.id"
            :class="{ on: tempUnit === u.id }"
            @click="setTempUnit(u.id)"
          >
            {{ u.label }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="store.state?.function === 'CONT'" class="field">
      <span class="lbl">Beep below</span>
      <div class="segmented">
        <button
          v-for="t in CONT_THRESHOLDS"
          :key="t"
          :class="{ on: store.state?.contThreshold === t }"
          @click="store.setContThreshold(t)"
        >
          {{ formatRangeLabel(t, 'Ω') }}
        </button>
      </div>
    </div>

    <div v-if="supportsNull" class="field">
      <span class="lbl">Relative <kbd>Z</kbd></span>
      <div class="rel">
        <button
          class="rel-btn"
          :class="{ primary: nullEnabled }"
          title="Zero against the current reading (tare)"
          @click="tare"
        >
          Δ Tare
        </button>
        <template v-if="nullEnabled">
          <span class="ref mono" title="Offset being subtracted">{{ nullOffset }}</span>
          <button class="ghost icon" title="Clear relative" @click="store.setNull(false, 0)">
            ✕
          </button>
        </template>
      </div>
    </div>

    <div class="field">
      <span class="lbl">Acquisition <kbd>Space</kbd></span>
      <div class="acq">
        <button
          class="run"
          :class="polling ? 'danger' : 'primary'"
          @click="store.setPolling(!polling)"
        >
          {{ polling ? '◼ Stop' : '▶ Run' }}
        </button>
        <button title="Single triggered reading (M)" @click="store.measureOnce()">Once</button>
        <select
          :value="store.state?.intervalMs ?? 100"
          title="Poll interval"
          aria-label="Poll interval"
          @change="store.setInterval(Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="ms in INTERVALS" :key="ms" :value="ms">
            every {{ intervalLabel(ms) }}
          </option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.controls.offline .keys,
.controls.offline .segmented {
  opacity: 0.6;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.lbl {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.lbl kbd {
  font-size: 10px;
  min-width: 16px;
  padding: 0 4px;
  line-height: 14px;
  opacity: 0.75;
}
.lbl kbd:first-of-type {
  margin-left: auto;
}
.pair {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.pair:empty {
  display: none;
}

/* Keypad keys: the instrument-front-panel part of the UI. */
.keys {
  display: grid;
  gap: 5px;
}
.fn-keys {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.range-keys {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.key {
  height: 36px;
  padding: 0 2px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  background: var(--panel-2);
  border-color: var(--border);
  box-shadow: 0 1px 0 var(--border);
}
.key.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.key.on:hover:not(:disabled) {
  background: var(--accent);
  border-color: var(--accent);
}
/* The AC/DC waveform marks read too small at text size; scale just the symbol. */
.sym {
  font-size: 1.25em;
  line-height: 1;
  margin-left: 3px;
  vertical-align: -0.08em;
}

.rel {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ref {
  font-size: 13px;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
}
.acq {
  display: flex;
  gap: 6px;
}
.acq .run {
  min-width: 78px;
}
.acq select {
  flex: 1;
}
</style>
