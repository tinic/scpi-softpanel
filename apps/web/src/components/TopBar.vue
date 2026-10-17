<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { useTheme } from '@/composables/useTheme'
import { useUi } from '@/composables/useUi'
import { formatDuration } from '@/lib/format'
import SettingsPanel from './SettingsPanel.vue'
import UiIcon from './UiIcon.vue'

const store = useMeterStore()
const { pref, cycle } = useTheme()
const { helpOpen } = useUi()
const version = __APP_VERSION__
const buildDate = __BUILD_DATE__

const idn = computed(() => store.state?.idn ?? '')
// IDN is "<vendor>,<model>,<serial>,<fw>"; the model is the only part worth header space.
const model = computed(() => {
  const parts = idn.value.split(',')
  return parts.length >= 2 ? parts[1].trim() : null
})
const instrumentTitle = computed(() =>
  [idn.value || 'No instrument session', store.state?.resource, store.state?.lastError]
    .filter(Boolean)
    .join('\n'),
)

// Effective reading rate over the last ~5 s — what NPLC + interval actually deliver.
const rate = computed(() => {
  const rs = store.readings
  if (rs.length < 3 || !store.state?.polling || !store.state.connected) return null
  const last = rs[rs.length - 1].ts
  let i = rs.length - 1
  while (i > 0 && last - rs[i - 1].ts < 5000) i--
  const n = rs.length - 1 - i
  const dt = (last - rs[i].ts) / 1000
  return n > 1 && dt > 0 ? n / dt : null
})

// Elapsed recording time ticks once a second.
const now = ref(Date.now())
const tick = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(tick))
const rec = computed(() => store.state?.recording ?? null)

const themeIcon = computed(() =>
  pref.value === 'system' ? 'auto' : pref.value === 'dark' ? 'moon' : 'sun',
)
const themeTitle = computed(
  () => `Theme: ${pref.value === 'system' ? 'follow system' : pref.value} (click to change)`,
)
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="2" y="5" width="28" height="22" rx="5" />
        <path d="M7 19l4-7 4 9 4-12 3 10h3" />
      </svg>
      <h1>SCPI <span>SoftPanel</span></h1>
      <span class="ver mono" :title="`Built ${buildDate}`">v{{ version }}</span>
    </div>

    <div class="status">
      <span
        class="chip"
        :class="{ warn: !store.linked }"
        :title="
          store.linked ? 'Connected to the SoftPanel server' : 'Server unreachable — retrying'
        "
      >
        <span class="dot" :class="store.linked ? 'on' : 'off'" />
        <span class="hide-sm">{{ store.linked ? 'Server' : 'Server offline' }}</span>
      </span>
      <span class="chip" :title="instrumentTitle">
        <span
          class="dot"
          :class="store.instrumentConnected ? 'on' : store.state?.enabled ? 'off' : ''"
        />
        <span class="mono strong">{{ model ?? 'No instrument' }}</span>
        <span v-if="rate != null" class="mono faint hide-sm">{{ rate.toFixed(1) }}/s</span>
      </span>
      <span v-if="rec" class="chip rec" :title="`Recording “${rec.name}”`">
        <span class="dot rec" />
        <span class="mono">REC {{ formatDuration(now - rec.started) }}</span>
      </span>
    </div>

    <div class="actions">
      <button
        v-if="store.state?.resource"
        class="conn"
        :class="store.state?.enabled ? 'danger' : 'primary'"
        :title="
          store.state?.enabled
            ? 'Close the session, then press Run/Stop on the meter to return it to local control'
            : 'Open a session to the meter'
        "
        @click="store.setConnected(!(store.state?.enabled ?? true))"
      >
        {{ store.state?.enabled ? 'Disconnect' : 'Connect' }}
      </button>
      <button class="ghost icon" :title="themeTitle" @click="cycle">
        <UiIcon :name="themeIcon" :size="16" />
      </button>
      <button class="ghost icon hide-sm" title="Keyboard shortcuts (?)" @click="helpOpen = true">
        <UiIcon name="keyboard" :size="17" />
      </button>
      <SettingsPanel />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  width: 28px;
  height: 28px;
  fill: var(--accent-soft);
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.logo path {
  fill: none;
}
h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
h1 span {
  color: var(--accent);
}
.ver {
  font-size: 11px;
  color: var(--faint);
}
.status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 11px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 999px;
  white-space: nowrap;
}
.chip.warn {
  color: var(--bad);
  border-color: color-mix(in srgb, var(--bad) 40%, transparent);
}
.chip.rec {
  color: var(--rec);
  border-color: color-mix(in srgb, var(--rec) 45%, transparent);
  font-weight: 700;
}
.strong {
  color: var(--text);
  font-weight: 700;
}
.faint {
  color: var(--faint);
}
.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
.conn {
  height: 30px;
  padding: 0 14px;
  font-size: 12px;
  border-radius: 999px;
  margin-right: 6px;
}
@media (max-width: 640px) {
  .hide-sm {
    display: none;
  }
  .topbar {
    gap: 10px;
  }
}
</style>
