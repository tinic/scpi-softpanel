<script setup lang="ts">
import { computed } from 'vue'
import { FUNCTION_INFO } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { useMath } from '@/composables/useMath'
import { DBM_IMPEDANCES, MATH_MODES, mathApplies, type MathMode } from '@/lib/math'
import { formatValue } from '@/lib/format'
import EngInput from './EngInput.vue'

const store = useMeterStore()
const { config, active, update } = useMath()

const fn = computed(() => store.state?.function ?? null)
const baseUnit = computed(() => (fn.value ? FUNCTION_INFO[fn.value].unit : ''))

/** Engineering display for a base-unit entry, e.g. 0.00295 → "2.95m". */
function eng(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return ''
  const f = formatValue(v, '')
  return `${f.sign}${Number.parseFloat(f.text)}${f.unit}`
}
const plainNum = (v: number | null) => (v == null ? '' : String(v))

function setMode(mode: MathMode): void {
  update({ mode })
}

/** Use the live (raw) reading as the reference — e.g. 0 dB at the input level. */
function fromCurrent(field: 'refV' | 'nominal'): void {
  const r = store.lastReading
  if (!r || !Number.isFinite(r.value) || r.function !== fn.value) return
  update({ [field]: field === 'refV' ? Math.abs(r.value) : r.value })
}

const hint = computed(() => MATH_MODES.find((m) => m.id === config.value.mode)?.hint ?? '')
</script>

<template>
  <div class="math">
    <div class="segmented modes" role="group" aria-label="Math mode">
      <button
        v-for="m in MATH_MODES"
        :key="m.id"
        :class="{ on: config.mode === m.id }"
        :disabled="m.id !== 'off' && !mathApplies(m.id, fn)"
        :title="m.hint"
        @click="setMode(m.id)"
      >
        {{ m.label }}
      </button>
    </div>

    <p v-if="config.mode !== 'off'" class="hint">
      {{ hint }}<template v-if="!active"> — not available for this function.</template>
    </p>

    <div v-if="config.mode === 'mxb'" class="grid3">
      <EngInput
        label="m (scale)"
        :model-value="config.m"
        :display="plainNum"
        @update:model-value="(v) => update({ m: v ?? 1 })"
      />
      <EngInput
        label="b (offset)"
        :model-value="config.b"
        :display="plainNum"
        @update:model-value="(v) => update({ b: v ?? 0 })"
      />
      <label class="txt">
        <span class="lbl">Unit</span>
        <input
          :value="config.unit"
          type="text"
          maxlength="8"
          placeholder="A, psi…"
          spellcheck="false"
          @change="update({ unit: ($event.target as HTMLInputElement).value.trim() })"
        />
      </label>
      <p class="hint wide">e.g. a 0.1 Ω shunt read as current: m = 10, b = 0, unit A.</p>
    </div>

    <div v-else-if="config.mode === 'pct'" class="row">
      <EngInput
        label="Nominal"
        :model-value="config.nominal"
        :display="eng"
        :units="[baseUnit]"
        :unit="baseUnit"
        @update:model-value="(v) => v != null && v !== 0 && update({ nominal: v })"
      />
      <button
        class="from"
        title="Use the current reading as nominal"
        @click="fromCurrent('nominal')"
      >
        Use current
      </button>
    </div>

    <div v-else-if="config.mode === 'db'" class="row">
      <EngInput
        label="Reference"
        :model-value="config.refV"
        :display="eng"
        :units="['V']"
        unit="V"
        @update:model-value="(v) => v != null && v > 0 && update({ refV: v })"
      />
      <button class="from" title="0 dB at the current level" @click="fromCurrent('refV')">
        Use current
      </button>
    </div>

    <div v-else-if="config.mode === 'dbm'" class="field">
      <span class="lbl">Reference impedance</span>
      <div class="row imp">
        <div class="segmented">
          <button
            v-for="z in DBM_IMPEDANCES"
            :key="z"
            :class="{ on: config.refOhm === z }"
            @click="update({ refOhm: z })"
          >
            {{ z >= 1000 ? `${z / 1000}k` : z }}
          </button>
        </div>
        <EngInput
          :model-value="config.refOhm"
          :display="eng"
          :units="['Ω']"
          unit="Ω"
          @update:model-value="(v) => v != null && v > 0 && update({ refOhm: v })"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.math {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modes {
  display: flex;
}
.modes button {
  flex: 1;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}
.grid3 {
  display: grid;
  grid-template-columns: 1fr 1fr 0.8fr;
  gap: 8px;
}
.wide {
  grid-column: 1 / -1;
}
.row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.row > :first-child {
  flex: 1;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.txt {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.lbl {
  font-size: 11px;
  color: var(--muted);
}
.txt input {
  width: 100%;
  font-family: var(--mono);
  font-size: 13px;
}
.imp .segmented {
  flex: 1;
  flex-wrap: nowrap;
}
.imp .segmented button {
  flex: 1;
  padding: 4px 6px;
}
.imp > :last-child {
  flex: 0 0 96px;
}
.from {
  white-space: nowrap;
  font-size: 12px;
  padding: 6px 10px;
}
</style>
