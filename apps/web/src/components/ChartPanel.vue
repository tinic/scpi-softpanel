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
      <a
        class="dl"
        href="/api/readings.csv"
        download="scpi-readings.csv"
        title="Download readings as CSV"
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v11" />
          <path d="M8 11l4 4 4-4" />
          <path d="M5 20h14" />
        </svg>
      </a>
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
  padding: 6px 9px;
  margin: -4px -5px; /* keep alignment despite the larger hit area */
  cursor: pointer;
  color: inherit;
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
}
.chev-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}
.chev {
  display: inline-block;
  font-size: 15px;
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
.dl {
  margin-left: auto;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--muted);
  opacity: 0.75;
}
.dl:hover {
  color: var(--text);
  opacity: 1;
}
.clear {
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
