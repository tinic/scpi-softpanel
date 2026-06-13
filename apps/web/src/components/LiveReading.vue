<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { FUNCTION_INFO } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { formatContinuity, formatValue } from '@/lib/format'
import { blipTone, setToneVolume, startTone, stopTone } from '@/lib/tone'

const store = useMeterStore()

// -- continuity tone -------------------------------------------------------
// Matches the meter's default continuity threshold (CONT:THR:VAL, 50 Ω).
const CONT_THRESHOLD_OHMS = 50
const SOUND_PREF_KEY = 'scpi.contSound'

const VOLUME_PREF_KEY = 'scpi.contVolume'

const soundOn = ref(localStorage.getItem(SOUND_PREF_KEY) !== 'off')
function toggleSound() {
  soundOn.value = !soundOn.value
  localStorage.setItem(SOUND_PREF_KEY, soundOn.value ? 'on' : 'off')
}

const storedVol = Number(localStorage.getItem(VOLUME_PREF_KEY))
const volPct = ref(Number.isFinite(storedVol) && storedVol > 0 ? storedVol : 40)
setToneVolume(volPct.value / 100)
function onVolume() {
  localStorage.setItem(VOLUME_PREF_KEY, String(volPct.value))
  setToneVolume(volPct.value / 100)
}
// Preview on release so the level can be judged without holding a short.
function onVolumeSet() {
  if (soundOn.value) blipTone()
}

// Stop the tone if readings stall (poll stopped, link lost) while shorted —
// each closed-circuit reading re-arms this.
let staleTimer: ReturnType<typeof setTimeout> | null = null

watch(
  [() => store.lastReading, () => store.state?.function, soundOn],
  () => {
    const r = store.lastReading
    const closed =
      soundOn.value &&
      store.state?.function === 'CONT' &&
      r?.function === 'CONT' &&
      Number.isFinite(r.value) &&
      r.value < CONT_THRESHOLD_OHMS
    if (staleTimer) clearTimeout(staleTimer)
    if (closed) {
      startTone()
      staleTimer = setTimeout(stopTone, 1500)
    } else {
      stopTone()
    }
  },
  { deep: false },
)

onBeforeUnmount(() => {
  if (staleTimer) clearTimeout(staleTimer)
  stopTone()
})

const functionLabel = computed(() => {
  const fn = store.state?.function
  return fn ? FUNCTION_INFO[fn].label : '—'
})

const isCont = computed(() => store.lastReading?.function === 'CONT')

const display = computed(() => {
  const r = store.lastReading
  if (!r) return { sign: '', text: '––––', unit: '' }
  return isCont.value ? formatContinuity(r.value) : formatValue(r.value, r.unit)
})

const overload = computed(() => store.lastReading?.overload ?? false)
// An open circuit is continuity's resting state, not an alarm — styled muted, not warn.
const contOpen = computed(() => overload.value && isCont.value)

// Baseline for the min/avg/max window; advancing it "clears" the stats so they
// re-accumulate from the current reading onward.
const statsSince = ref(0)
function clearStats() {
  statsSince.value = store.lastReading?.ts ?? Date.now()
}

const stats = computed(() => {
  // min/max/avg over the in-range window since the last clear; only readings from
  // the current function count, or a function switch would mix incompatible units.
  const fn = store.lastReading?.function
  const vals = store.readings
    .filter((r) => r.function === fn && Number.isFinite(r.value) && r.ts >= statsSince.value)
    .map((r) => r.value)
  if (vals.length === 0) return null
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  const unit = store.lastReading?.unit ?? ''
  const fmt = isCont.value ? formatContinuity : (v: number) => formatValue(v, unit)
  return {
    min: fmt(min),
    max: fmt(max),
    avg: fmt(avg),
  }
})
</script>

<template>
  <div class="live">
    <div class="fn">
      {{ functionLabel }}
      <template v-if="store.state?.function === 'CONT'">
        <button
          class="snd"
          :class="{ on: soundOn }"
          :title="soundOn ? 'Continuity tone: on' : 'Continuity tone: muted'"
          @click="toggleSound"
        >
          {{ soundOn ? '◗))' : '◗' }}
        </button>
        <input
          v-model.number="volPct"
          class="vol"
          type="range"
          min="5"
          max="100"
          step="5"
          title="Continuity tone volume"
          :disabled="!soundOn"
          @input="onVolume"
          @change="onVolumeSet"
        />
      </template>
    </div>
    <div class="value" :class="{ overload: overload && !contOpen, open: contOpen }">
      <span class="mag">
        <span class="sign">{{ display.sign }}</span>
        <span class="num">{{ display.text }}</span>
      </span>
      <span class="unit">{{ display.unit }}</span>
    </div>
    <div v-if="stats" class="stats">
      <div class="stat">
        <label>min</label>
        <span class="sv">{{ stats.min.sign }}{{ stats.min.text }} {{ stats.min.unit }}</span>
      </div>
      <div class="stat">
        <label>avg</label>
        <span class="sv">{{ stats.avg.sign }}{{ stats.avg.text }} {{ stats.avg.unit }}</span>
      </div>
      <div class="stat">
        <label>max</label>
        <span class="sv">{{ stats.max.sign }}{{ stats.max.text }} {{ stats.max.unit }}</span>
      </div>
      <button class="clear-stats" title="Clear min / avg / max" @click="clearStats">↺</button>
    </div>
  </div>
</template>

<style scoped>
.live {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  gap: 10px;
}
.fn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.snd {
  padding: 2px 10px;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 999px;
  color: var(--muted);
  letter-spacing: normal;
}
.snd.on {
  color: var(--accent);
  border-color: var(--accent);
}
.vol {
  appearance: none;
  width: 88px;
  height: 4px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: var(--border);
  cursor: pointer;
}
.vol::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
}
.vol::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: none;
  border-radius: 50%;
  background: var(--accent);
}
.vol:disabled {
  opacity: 0.4;
  cursor: default;
}
.vol:disabled::-webkit-slider-thumb {
  background: var(--muted);
}
.vol:disabled::-moz-range-thumb {
  background: var(--muted);
}
.value {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 12px;
  white-space: nowrap;
}
.mag {
  display: inline-flex;
  align-items: baseline;
  font-family: 'Iosevka', ui-monospace, monospace;
  font-weight: 800;
  font-size: 96px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
/* Fixed-width sign column so digits don't shift when the reading crosses zero. */
.sign {
  display: inline-block;
  width: 1ch;
  text-align: center;
}
.unit {
  font-family: 'Iosevka', ui-monospace, monospace;
  font-weight: 800;
  font-size: 38px;
  color: var(--accent);
}
.value.overload .mag {
  color: var(--warn);
}
.value.open .mag {
  color: var(--muted);
}
.stats {
  display: flex;
  align-items: flex-end;
  gap: 28px;
  margin-top: 6px;
  padding: 14px 32px 0;
  border-top: 1px solid var(--border);
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.stat label {
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.sv {
  font-family: 'Iosevka', ui-monospace, monospace;
  font-weight: 800;
  font-size: 15px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.clear-stats {
  width: 22px;
  height: 22px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 13px;
  line-height: 1;
  color: var(--muted);
}
.clear-stats:hover {
  color: var(--text);
}
</style>
