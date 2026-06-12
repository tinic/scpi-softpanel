<script setup lang="ts">
import { computed } from 'vue'
import { useMeterStore } from '@/stores/meter'

const store = useMeterStore()
const idn = computed(() => store.state?.idn ?? '—')
const polling = computed(() => store.state?.polling ?? false)
const interval = computed(() => store.state?.intervalMs ?? 0)
</script>

<template>
  <div class="status">
    <span class="item" :title="store.linked ? 'connected to broker' : 'broker offline'">
      <span class="dot" :class="store.linked ? 'on' : 'off'" />broker
    </span>
    <span class="item" :title="idn">
      <span class="dot" :class="store.instrumentConnected ? 'on' : 'off'" />instrument
    </span>
    <span class="idn">{{ idn }}</span>
    <span class="item poll">
      <span class="dot" :class="polling ? 'on' : ''" />{{
        polling ? `polling @ ${interval}ms` : 'idle'
      }}
    </span>
  </div>
</template>

<style scoped>
.status {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--muted);
}
.item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.idn {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--text);
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
