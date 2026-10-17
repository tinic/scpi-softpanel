<script setup lang="ts">
import { computed, ref } from 'vue'
import TrendChart from './TrendChart.vue'
import HistogramChart from './HistogramChart.vue'
import AnalogMeter from './AnalogMeter.vue'
import SessionsView from './SessionsView.vue'
import UiIcon from './UiIcon.vue'
import { useChartWindow } from '@/composables/useChartWindow'
import { CHART_TABS, useUi } from '@/composables/useUi'

const { clear } = useChartWindow()
const { chartTab: tab, setChartTab } = useUi()

const trend = ref<InstanceType<typeof TrendChart> | null>(null)
const hist = ref<InstanceType<typeof HistogramChart> | null>(null)
const sessions = ref<InstanceType<typeof SessionsView> | null>(null)

const exportable = computed(() => tab.value !== 'meter')
function exportImage(): void {
  if (tab.value === 'trend') trend.value?.exportImage()
  else if (tab.value === 'histogram') hist.value?.exportImage()
  else if (tab.value === 'sessions') sessions.value?.exportImage()
}
const live = computed(() => tab.value !== 'sessions')
</script>

<template>
  <div class="chart-panel">
    <div class="head">
      <div class="tabs" role="tablist">
        <button
          v-for="(t, i) in CHART_TABS"
          :key="t.id"
          class="tab"
          role="tab"
          :aria-selected="tab === t.id"
          :class="{ active: tab === t.id }"
          :title="`${t.label} (${i + 1})`"
          @click="setChartTab(t.id)"
        >
          {{ t.label }}
        </button>
      </div>
      <div class="actions">
        <button v-if="exportable" class="ghost icon" title="Save chart as PNG" @click="exportImage">
          <UiIcon name="image" :size="15" />
        </button>
        <a
          v-if="live"
          class="icon-link"
          href="/api/readings.csv"
          download="scpi-readings.csv"
          title="Download the live buffer as CSV"
        >
          <UiIcon name="download" :size="15" />
        </a>
        <button v-if="live" class="ghost icon" title="Clear chart data" @click="clear">
          <UiIcon name="reset" :size="15" />
        </button>
      </div>
    </div>
    <div class="body">
      <TrendChart v-show="tab === 'trend'" ref="trend" />
      <HistogramChart v-show="tab === 'histogram'" ref="hist" />
      <AnalogMeter v-show="tab === 'meter'" />
      <SessionsView v-show="tab === 'sessions'" ref="sessions" />
    </div>
  </div>
</template>

<style scoped>
.chart-panel {
  padding: 8px 16px 16px;
}
.head {
  display: flex;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid var(--border);
}
.tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
}
.tab {
  padding: 10px 12px 9px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  margin-bottom: -1px;
  white-space: nowrap;
}
.tab:hover:not(:disabled) {
  color: var(--text);
  background: none;
}
.tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
.icon-link {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--muted);
}
.icon-link:hover {
  color: var(--text);
  background: var(--panel-3);
}
.body {
  margin-top: 14px;
}
@media (max-width: 640px) {
  .chart-panel {
    padding: 4px 10px 12px;
  }
  .tab {
    padding: 10px 7px 9px;
  }
  .head {
    gap: 4px;
  }
}
</style>
