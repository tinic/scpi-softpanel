<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { useUi } from '@/composables/useUi'
import { formatDuration as fmtDuration } from '@/lib/format'
import UiIcon from './UiIcon.vue'

const store = useMeterStore()
const { setChartTab } = useUi()

const name = ref('')
const marker = ref('')

/** Planned session lengths; null = until stopped. */
const DURATIONS: { ms: number | null; label: string }[] = [
  { ms: null, label: '∞' },
  { ms: 60_000, label: '1 m' },
  { ms: 600_000, label: '10 m' },
  { ms: 3_600_000, label: '1 h' },
  { ms: 8 * 3_600_000, label: '8 h' },
  { ms: 24 * 3_600_000, label: '24 h' },
]
const duration = ref<number | null>(null)

const rec = computed(() => store.state?.recording ?? null)
const available = computed(() => store.state?.recordingAvailable ?? false)

// A 1 s clock for the elapsed/remaining display, only while recording.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
watch(
  rec,
  (r) => {
    if (r && !timer) timer = setInterval(() => (now.value = Date.now()), 1000)
    if (!r && timer) {
      clearInterval(timer)
      timer = null
    }
    now.value = Date.now()
  },
  { immediate: true },
)
onBeforeUnmount(() => timer && clearInterval(timer))

const elapsed = computed(() => (rec.value ? now.value - rec.value.started : 0))
const progress = computed(() =>
  rec.value?.durationMs ? Math.min(1, elapsed.value / rec.value.durationMs) : null,
)

function start(): void {
  store.startRecording(name.value.trim(), duration.value)
  name.value = ''
}
function stop(): void {
  store.stopRecording()
  setChartTab('sessions')
}
function mark(): void {
  store.addMarker(marker.value.trim())
  marker.value = ''
}
</script>

<template>
  <div class="logging">
    <p v-if="!available" class="hint">
      Recording isn't available: the server has no data directory to write to.
    </p>

    <template v-else-if="!rec">
      <input
        v-model="name"
        type="text"
        maxlength="120"
        placeholder="Session name (optional)"
        spellcheck="false"
        @keydown.enter="start"
      />
      <div class="field">
        <span class="lbl">Stop after</span>
        <div class="segmented dur">
          <button
            v-for="d in DURATIONS"
            :key="d.label"
            :class="{ on: duration === d.ms }"
            @click="duration = d.ms"
          >
            {{ d.label }}
          </button>
        </div>
      </div>
      <button class="record" :disabled="!store.instrumentConnected" @click="start">
        <span class="rdot" /> Record to disk
      </button>
    </template>

    <template v-else>
      <div class="live-rec">
        <span class="dot rec" />
        <div class="meta">
          <span class="nm" :title="rec.name">{{ rec.name }}</span>
          <span class="mono el">
            {{ fmtDuration(elapsed) }}
            <template v-if="rec.durationMs"> / {{ fmtDuration(rec.durationMs) }}</template>
          </span>
        </div>
        <button class="danger stop" @click="stop"><UiIcon name="stop" :size="13" /> Stop</button>
      </div>
      <div v-if="progress != null" class="bar">
        <span :style="{ width: `${progress * 100}%` }" />
      </div>
    </template>

    <div class="field">
      <span class="lbl">Marker <kbd>K</kbd></span>
      <div class="mk">
        <input
          v-model="marker"
          type="text"
          maxlength="200"
          placeholder="Note on the trend, e.g. heater on"
          spellcheck="false"
          @keydown.enter="mark"
        />
        <button class="icon" title="Drop a marker now" @click="mark">
          <UiIcon name="flag" :size="15" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.logging {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
}
.logging > input {
  width: 100%;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lbl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted);
}
.lbl kbd {
  font-size: 10px;
  line-height: 14px;
  opacity: 0.75;
}
.dur {
  display: flex;
}
.dur button {
  flex: 1;
  padding: 4px 4px;
}
.record {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  font-weight: 600;
}
.rdot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--rec);
}
.live-rec {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--rec) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--rec) 35%, transparent);
}
.meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.nm {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.el {
  font-size: 13px;
  color: var(--muted);
}
.stop {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.bar {
  height: 4px;
  border-radius: 2px;
  background: var(--panel-3);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--rec);
  transition: width 1s linear;
}
.mk {
  display: flex;
  gap: 6px;
}
.mk input {
  flex: 1;
}
.mk .icon {
  width: 34px;
  height: auto;
}
</style>
