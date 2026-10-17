<script setup lang="ts">
import { computed } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { toEntry, useDisplay } from '@/composables/useDisplay'
import { useLimits } from '@/composables/useLimits'
import { fromTolerance } from '@/lib/limits'
import EngInput from './EngInput.vue'

const store = useMeterStore()
const { channel } = useDisplay()
const { limits, verdict, counts, alarm, update, resetCounts, setAlarm } = useLimits()

const display = (v: number | null) => toEntry(channel.value, v)
const unitPrefixless = computed(() => channel.value.entryUnit)

const TOLERANCES = [0.1, 1, 5, 10]
/** Center a ± band on the current display value (component sorting, quick checks). */
function aroundCurrent(pct: number): void {
  const r = store.lastReading
  if (!r || r.function !== store.state?.function) return
  const v = channel.value.value(r)
  if (!Number.isFinite(v)) return
  const { lo, hi } = fromTolerance(v, pct)
  update({ lo, hi, enabled: true })
}

const total = computed(() => counts.pass + counts.lo + counts.hi)
const yieldPct = computed(() => (total.value ? (counts.pass / total.value) * 100 : null))
const notifySupported = 'Notification' in window
</script>

<template>
  <div class="limits">
    <label class="toggle">
      <input
        type="checkbox"
        class="switch"
        :checked="limits.enabled"
        @change="update({ enabled: ($event.target as HTMLInputElement).checked })"
      />
      <span>Test readings against limits</span>
    </label>

    <div class="bounds">
      <EngInput
        label="Low"
        nullable
        placeholder="none"
        :model-value="limits.lo"
        :display="display"
        :units="channel.entryUnits"
        :unit="unitPrefixless"
        @update:model-value="(v) => update({ lo: v })"
      />
      <EngInput
        label="High"
        nullable
        placeholder="none"
        :model-value="limits.hi"
        :display="display"
        :units="channel.entryUnits"
        :unit="unitPrefixless"
        @update:model-value="(v) => update({ hi: v })"
      />
    </div>

    <div class="field">
      <span class="lbl">Around current reading</span>
      <div class="segmented tol">
        <button v-for="t in TOLERANCES" :key="t" @click="aroundCurrent(t)">± {{ t }}%</button>
      </div>
    </div>

    <div v-if="limits.enabled" class="tally">
      <div class="t pass" :class="{ now: verdict === 'pass' }">
        <span class="n mono">{{ counts.pass.toLocaleString() }}</span
        ><span>pass</span>
      </div>
      <div class="t fail" :class="{ now: verdict === 'lo' }">
        <span class="n mono">{{ counts.lo.toLocaleString() }}</span
        ><span>low</span>
      </div>
      <div class="t fail" :class="{ now: verdict === 'hi' }">
        <span class="n mono">{{ counts.hi.toLocaleString() }}</span
        ><span>high</span>
      </div>
      <div class="t">
        <span class="n mono">{{ yieldPct == null ? '—' : `${yieldPct.toFixed(1)}%` }}</span
        ><span>yield</span>
      </div>
      <button class="ghost icon" title="Reset counts" @click="resetCounts">↺</button>
    </div>

    <div class="alarms">
      <label class="toggle small">
        <input
          type="checkbox"
          class="switch"
          :checked="alarm.sound"
          @change="setAlarm({ sound: ($event.target as HTMLInputElement).checked })"
        />
        <span>Beep on fail</span>
      </label>
      <label v-if="notifySupported" class="toggle small" title="Only while this tab is hidden">
        <input
          type="checkbox"
          class="switch"
          :checked="alarm.notify"
          @change="setAlarm({ notify: ($event.target as HTMLInputElement).checked })"
        />
        <span>Notify when away</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.limits {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  cursor: pointer;
}
.toggle.small {
  font-size: 12px;
  color: var(--muted);
}
.bounds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lbl {
  font-size: 11px;
  color: var(--muted);
}
.tol {
  display: flex;
}
.tol button {
  flex: 1;
}
.tally {
  display: grid;
  grid-template-columns: repeat(4, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  border: 1px solid var(--border);
}
.t {
  display: flex;
  flex-direction: column;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.t .n {
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
  text-transform: none;
  letter-spacing: 0;
}
.t.pass.now .n {
  color: var(--good);
}
.t.fail.now .n {
  color: var(--bad);
}
.alarms {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
}
</style>
