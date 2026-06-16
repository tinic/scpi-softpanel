<script setup lang="ts">
import { computed } from 'vue'
import { useMeterStore } from '@/stores/meter'

const store = useMeterStore()
const idn = computed(() => store.state?.idn ?? '—')
// IDN is "<vendor>,<model>,<serial>,<fw>"; the model is the only part worth header space.
const model = computed(() => {
  const parts = store.state?.idn?.split(',') ?? []
  return parts.length >= 2 ? parts[1].trim() : null
})
// Only "polling" when actually connected and reading; otherwise idle.
const polling = computed(() => (store.state?.connected ?? false) && (store.state?.polling ?? false))
const interval = computed(() => store.state?.intervalMs ?? 0)
</script>

<template>
  <div class="status">
    <span class="pill" :title="store.linked ? 'connected to broker' : 'broker offline'">
      <span class="dot" :class="store.linked ? 'on' : 'off'" />broker
    </span>
    <span class="pill" :title="idn">
      <span class="dot" :class="store.instrumentConnected ? 'on' : 'off'" />
      <span :class="{ model: model }">{{ model ?? 'instrument' }}</span>
    </span>
    <span class="pill">
      <span class="dot" :class="polling ? 'on' : ''" />{{
        polling ? `polling @ ${interval} ms` : 'idle'
      }}
    </span>
  </div>
</template>

<style scoped>
.status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 999px;
  white-space: nowrap;
}
.model {
  color: var(--text);
  font-family: ui-monospace, monospace;
}
</style>
