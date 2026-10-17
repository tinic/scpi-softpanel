<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { installLimitWatcher, useLimits } from '@/composables/useLimits'
import { useMath } from '@/composables/useMath'
import { useShortcuts } from '@/composables/useShortcuts'
import { useUi } from '@/composables/useUi'
import TopBar from '@/components/TopBar.vue'
import LiveReading from '@/components/LiveReading.vue'
import ControlPanel from '@/components/ControlPanel.vue'
import MathPanel from '@/components/MathPanel.vue'
import LimitsPanel from '@/components/LimitsPanel.vue'
import LoggingPanel from '@/components/LoggingPanel.vue'
import ChartPanel from '@/components/ChartPanel.vue'
import RawConsole from '@/components/RawConsole.vue'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import RailSection from '@/components/RailSection.vue'
import BigReadout from '@/components/BigReadout.vue'
import ShortcutsHelp from '@/components/ShortcutsHelp.vue'

const store = useMeterStore()
const { bigMode, helpOpen } = useUi()
const { active: mathOn, config: mathCfg } = useMath()
const { active: limitsOn, verdict } = useLimits()
useShortcuts()
installLimitWatcher()
onMounted(() => store.connect())

const limitBadge = computed(() => {
  if (!limitsOn.value) return null
  const v = verdict.value
  return v === 'pass' ? 'PASS' : v === 'hi' ? 'HI' : v === 'lo' ? 'LO' : 'ON'
})
</script>

<template>
  <div class="app">
    <TopBar />

    <main class="layout">
      <section class="card area-live"><LiveReading /></section>

      <aside class="area-rail">
        <RailSection id="measure" title="Measurement" :collapsible="false">
          <ControlPanel />
        </RailSection>
        <RailSection id="math" title="Math" :default-open="false">
          <template #badge>
            <span v-if="mathOn" class="badge on">{{
              mathCfg.mode === 'mxb' ? 'mX+b' : mathCfg.mode
            }}</span>
            <span v-else class="badge">off</span>
          </template>
          <MathPanel />
        </RailSection>
        <RailSection id="limits" title="Limits" :default-open="false">
          <template #badge>
            <span
              v-if="limitBadge"
              class="badge"
              :class="limitBadge === 'PASS' ? 'good' : limitBadge === 'ON' ? 'on' : 'bad'"
              >{{ limitBadge }}</span
            >
            <span v-else class="badge">off</span>
          </template>
          <LimitsPanel />
        </RailSection>
        <RailSection id="logging" title="Logging">
          <template #badge>
            <span v-if="store.state?.recording" class="badge rec">REC</span>
          </template>
          <LoggingPanel />
        </RailSection>
      </aside>

      <section class="card area-chart"><ChartPanel /></section>

      <section class="card area-console">
        <CollapsibleSection title="SCPI Console" :default-open="false">
          <RawConsole />
        </CollapsibleSection>
      </section>
    </main>

    <BigReadout v-if="bigMode" />
    <ShortcutsHelp v-if="helpOpen" />
  </div>
</template>

<style scoped>
.app {
  max-width: 1520px;
  margin: 0 auto;
  padding: 16px 20px 28px;
}
.layout {
  display: grid;
  gap: 14px;
  grid-template-columns: minmax(0, 1fr) 372px;
  grid-template-rows: auto auto 1fr;
  grid-template-areas:
    'live rail'
    'chart rail'
    'console rail';
  align-items: start;
}
.area-live {
  grid-area: live;
  overflow: hidden;
}
.area-rail {
  grid-area: rail;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.area-chart {
  grid-area: chart;
}
.area-console {
  grid-area: console;
  padding: 10px 16px;
}
.badge {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 5px;
  color: var(--faint);
  background: var(--panel-2);
}
.badge.on {
  color: var(--accent);
  background: var(--accent-soft);
}
.badge.good {
  color: var(--good);
  background: var(--good-soft);
}
.badge.bad {
  color: var(--bad);
  background: var(--bad-soft);
}
.badge.rec {
  color: #fff;
  background: var(--rec);
}

/* Narrower: the rail drops below the readout and lays its cards out side by side. */
@media (max-width: 1100px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'live' 'rail' 'chart' 'console';
  }
  /* Two flowing columns, so a collapsed card doesn't leave a hole beside a tall one. */
  .area-rail {
    display: block;
    columns: 2 320px;
    column-gap: 14px;
  }
  .area-rail > * {
    break-inside: avoid;
    margin-bottom: 14px;
  }
}
@media (max-width: 640px) {
  .app {
    padding: 12px 12px 24px;
  }
}
</style>
