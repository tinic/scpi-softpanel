<script setup lang="ts">
import { computed, ref } from 'vue'
import { FUNCTION_INFO } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { formatValue } from '@/lib/format'

const store = useMeterStore()

const functionLabel = computed(() => {
  const fn = store.state?.function
  return fn ? FUNCTION_INFO[fn].label : '—'
})

const display = computed(() => {
  const r = store.lastReading
  if (!r) return { sign: '', text: '––––', unit: '' }
  return formatValue(r.value, r.unit)
})

const overload = computed(() => store.lastReading?.overload ?? false)

// Baseline for the min/avg/max window; advancing it "clears" the stats so they
// re-accumulate from the current reading onward.
const statsSince = ref(0)
function clearStats() {
  statsSince.value = store.lastReading?.ts ?? Date.now()
}

const stats = computed(() => {
  // min/max/avg over the in-range window since the last clear
  const vals = store.readings
    .filter((r) => Number.isFinite(r.value) && r.ts >= statsSince.value)
    .map((r) => r.value)
  if (vals.length === 0) return null
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  const unit = store.lastReading?.unit ?? ''
  return {
    min: formatValue(min, unit),
    max: formatValue(max, unit),
    avg: formatValue(avg, unit),
  }
})
</script>

<template>
  <div class="live">
    <div class="fn">{{ functionLabel }}</div>
    <div class="value" :class="{ overload }">
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
  font-size: 13px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
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
