<script setup lang="ts">
import { computed } from 'vue'
import { FUNCTION_INFO, METER_FUNCTIONS, NPLC_CHOICES } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { formatRangeLabel } from '@/lib/format'
import { useTempUnit } from '@/composables/useTempUnit'
import type { TempUnit } from '@/lib/format'

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

// Continuity beep threshold presets; the meter accepts 0–2000 Ω (default 50)
// and resets to the default on every function change.
const CONT_THRESHOLDS = [1, 10, 50, 100, 500, 1000]

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
</script>

<template>
  <div class="controls">
    <div class="row">
      <label>Function</label>
      <div class="seg">
        <button
          v-for="fn in functions"
          :key="fn"
          :title="FUNCTION_INFO[fn].label"
          :class="{ primary: store.state?.function === fn }"
          @click="store.setFunction(fn)"
        >
          <template v-if="splitShort(FUNCTION_INFO[fn].short).sym"
            >{{ splitShort(FUNCTION_INFO[fn].short).pre
            }}<span class="sym">{{ splitShort(FUNCTION_INFO[fn].short).sym }}</span></template
          >
          <template v-else>{{ FUNCTION_INFO[fn].short }}</template>
        </button>
      </div>
    </div>

    <div v-if="currentInfo?.ranges" class="row">
      <label>Range</label>
      <div class="seg">
        <button :class="{ primary: autoRange }" @click="store.setAutoRange(true)">Auto</button>
        <button
          v-for="r in currentInfo.ranges"
          :key="r"
          :class="{ primary: !autoRange && activeRange === r }"
          @click="store.setRange(String(r))"
        >
          {{ formatRangeLabel(r, currentInfo.unit) }}
        </button>
      </div>
    </div>

    <div v-if="store.state?.function === 'CONT'" class="row">
      <label>Beep &lt;</label>
      <div class="seg">
        <button
          v-for="t in CONT_THRESHOLDS"
          :key="t"
          :class="{ primary: store.state?.contThreshold === t }"
          @click="store.setContThreshold(t)"
        >
          {{ formatRangeLabel(t, 'Ω') }}
        </button>
      </div>
    </div>

    <div v-if="store.state?.function === 'TEMP'" class="row">
      <label>Unit</label>
      <div class="seg">
        <button
          v-for="u in TEMP_UNITS"
          :key="u.id"
          :class="{ primary: tempUnit === u.id }"
          @click="setTempUnit(u.id)"
        >
          {{ u.label }}
        </button>
      </div>
    </div>

    <div v-if="currentInfo?.supportsNplc" class="row">
      <label>NPLC</label>
      <div class="seg">
        <button
          v-for="p in NPLC_CHOICES"
          :key="p"
          :class="{ primary: store.state?.nplc === p }"
          @click="store.setNplc(p)"
        >
          {{ p }}
        </button>
      </div>
    </div>

    <div class="row">
      <label>Polling</label>
      <div class="seg">
        <button
          :class="store.state?.polling ? 'danger' : 'primary'"
          @click="store.setPolling(!(store.state?.polling ?? false))"
        >
          {{ store.state?.polling ? '◼ Stop' : '▶ Run' }}
        </button>
        <button class="wide" title="Single triggered reading" @click="store.measureOnce()">
          Measure once
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.row {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: start;
  gap: 12px;
}
.row > label {
  color: var(--muted);
  font-size: 13px;
  padding-top: 7px;
}
/* Uniform column tracks so wrapped rows align into a keypad-like grid. */
.seg {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
}
.seg button {
  padding: 6px 4px;
  white-space: nowrap;
}
.seg button.wide {
  grid-column: span 2;
}
/* The AC/DC waveform marks read too small at text size; scale just the symbol. */
.sym {
  font-size: 1.3em;
  line-height: 1;
  margin-left: 5px;
  vertical-align: -0.1em;
}
</style>
