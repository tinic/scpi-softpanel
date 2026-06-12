<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FUNCTION_INFO, METER_FUNCTIONS, type MeterFunction } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'

const store = useMeterStore()

const functions = METER_FUNCTIONS
const currentInfo = computed(() =>
  store.state?.function ? FUNCTION_INFO[store.state.function] : null,
)

const NPLC_PRESETS = [0.3, 1, 10, 100]

// Local edit buffers that follow server state when it changes.
const rangeInput = ref('')
const intervalInput = ref(100)
watch(
  () => store.state?.range,
  (r) => {
    if (r && r !== 'AUTO') rangeInput.value = r
  },
)
watch(
  () => store.state?.intervalMs,
  (ms) => {
    if (ms) intervalInput.value = ms
  },
  { immediate: true },
)

function onFunction(e: Event) {
  store.setFunction((e.target as HTMLSelectElement).value as MeterFunction)
}
function applyRange() {
  if (rangeInput.value.trim()) store.setRange(rangeInput.value.trim())
}
function applyInterval() {
  store.setInterval(Math.max(50, Math.min(60000, Math.round(intervalInput.value))))
}
</script>

<template>
  <div class="controls">
    <div class="row">
      <label>Function</label>
      <select :value="store.state?.function ?? ''" @change="onFunction">
        <option v-for="fn in functions" :key="fn" :value="fn">{{ FUNCTION_INFO[fn].label }}</option>
      </select>
    </div>

    <div class="row">
      <label>Range</label>
      <div class="inline">
        <label class="chk">
          <input
            type="checkbox"
            :checked="store.state?.autoRange ?? false"
            :disabled="!currentInfo?.supportsRange"
            @change="store.setAutoRange(($event.target as HTMLInputElement).checked)"
          />
          auto
        </label>
        <input
          v-model="rangeInput"
          type="text"
          placeholder="e.g. 2"
          :disabled="!currentInfo?.supportsRange || (store.state?.autoRange ?? false)"
          @keyup.enter="applyRange"
        />
        <button
          :disabled="!currentInfo?.supportsRange || (store.state?.autoRange ?? false)"
          @click="applyRange"
        >
          Set
        </button>
      </div>
    </div>

    <div class="row">
      <label>NPLC</label>
      <div class="inline">
        <button
          v-for="p in NPLC_PRESETS"
          :key="p"
          :disabled="!currentInfo?.supportsNplc"
          :class="{ primary: store.state?.nplc === p }"
          @click="store.setNplc(p)"
        >
          {{ p }}
        </button>
        <span v-if="!currentInfo?.supportsNplc" class="muted">n/a</span>
      </div>
    </div>

    <div class="row">
      <label>Polling</label>
      <div class="inline">
        <button
          :class="store.state?.polling ? 'danger' : 'primary'"
          @click="store.setPolling(!(store.state?.polling ?? false))"
        >
          {{ store.state?.polling ? 'Stop' : 'Start' }}
        </button>
        <input
          v-model.number="intervalInput"
          type="number"
          min="50"
          max="60000"
          step="50"
          @change="applyInterval"
        />
        <span class="muted">ms</span>
        <button @click="store.measureOnce()">Measure once</button>
      </div>
    </div>

    <div class="row">
      <label></label>
      <button @click="store.refresh()">Refresh state</button>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: 12px;
}
.row > label {
  color: var(--muted);
  font-size: 13px;
}
.inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.inline input[type='text'],
.inline input[type='number'] {
  width: 90px;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text);
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
</style>
