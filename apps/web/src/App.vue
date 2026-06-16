<script setup lang="ts">
import { onMounted } from 'vue'
import { useMeterStore } from '@/stores/meter'
import StatusBar from '@/components/StatusBar.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import LiveReading from '@/components/LiveReading.vue'
import ControlPanel from '@/components/ControlPanel.vue'
import TrendChart from '@/components/TrendChart.vue'
import RawConsole from '@/components/RawConsole.vue'
import CollapsibleSection from '@/components/CollapsibleSection.vue'

const store = useMeterStore()
onMounted(() => store.connect())
</script>

<template>
  <div class="app">
    <header class="topbar">
      <h1>SCPI <span>SoftPanel</span></h1>
      <div class="topbar-right">
        <StatusBar />
        <SettingsPanel />
      </div>
    </header>

    <main class="grid">
      <section class="card area-live"><LiveReading /></section>
      <section class="card area-controls">
        <h2>Controls</h2>
        <ControlPanel />
      </section>
      <section class="card area-trend">
        <CollapsibleSection title="Trend">
          <TrendChart />
        </CollapsibleSection>
      </section>
      <section class="card area-console">
        <CollapsibleSection title="SCPI Console" :default-open="false">
          <RawConsole />
        </CollapsibleSection>
      </section>
    </main>
  </div>
</template>

<style scoped>
.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
h1 span {
  color: var(--accent);
}
.grid {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr 1fr;
  grid-template-areas:
    'live controls'
    'trend trend'
    'console console';
}
.area-live {
  grid-area: live;
}
.area-controls {
  grid-area: controls;
}
.area-trend {
  grid-area: trend;
}
.area-console {
  grid-area: console;
}
@media (max-width: 760px) {
  .grid {
    grid-template-columns: 1fr;
    grid-template-areas: 'live' 'controls' 'trend' 'console';
  }
}
</style>
