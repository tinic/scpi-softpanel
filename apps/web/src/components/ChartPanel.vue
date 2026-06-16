<script setup lang="ts">
import { ref } from 'vue'
import TrendChart from './TrendChart.vue'
import HistogramChart from './HistogramChart.vue'
import { useChartWindow } from '@/composables/useChartWindow'

type Tab = 'trend' | 'histogram'
const open = ref(true)
const tab = ref<Tab>('trend')
const { clear } = useChartWindow()

// Selecting a tab also expands the panel if it was collapsed.
function select(t: Tab): void {
  tab.value = t
  open.value = true
}
</script>

<template>
  <div class="chart-panel">
    <div class="head">
      <button
        class="chev-btn"
        :aria-expanded="open"
        title="Collapse / expand"
        @click="open = !open"
      >
        <span class="chev" :class="{ open }">▸</span>
      </button>
      <div class="tabs" role="tablist">
        <button
          class="tab"
          role="tab"
          :aria-selected="tab === 'trend'"
          :class="{ active: tab === 'trend' }"
          @click="select('trend')"
        >
          Trend
        </button>
        <button
          class="tab"
          role="tab"
          :aria-selected="tab === 'histogram'"
          :class="{ active: tab === 'histogram' }"
          @click="select('histogram')"
        >
          Histogram
        </button>
      </div>
      <button class="clear" title="Clear data" @click="clear">↺</button>
    </div>
    <div v-show="open" class="body">
      <TrendChart v-show="tab === 'trend'" />
      <HistogramChart v-show="tab === 'histogram'" />
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.chev-btn {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  display: inline-flex;
}
.chev {
  display: inline-block;
  font-size: 11px;
  color: var(--muted);
  transition: transform 0.15s ease;
}
.chev.open {
  transform: rotate(90deg);
}
.chev-btn:hover .chev {
  color: var(--text);
}
.tabs {
  display: flex;
  gap: 4px;
}
.tab {
  padding: 4px 12px 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  cursor: pointer;
}
.tab:hover {
  color: var(--text);
}
.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.clear {
  margin-left: auto;
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 14px;
  line-height: 1;
  color: var(--muted);
  opacity: 0.7;
}
.clear:hover {
  color: var(--text);
  opacity: 1;
}
.body {
  margin-top: 14px;
}
</style>
