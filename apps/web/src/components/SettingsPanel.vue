<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { useDisplayFont, type DisplayFont } from '@/composables/useDisplayFont'
import { useTheme, type ThemePref } from '@/composables/useTheme'
import { STABLE_TOLERANCES, useStats } from '@/composables/useStats'
import UiIcon from './UiIcon.vue'

const store = useMeterStore()
const open = ref(false)
const host = ref('')
const port = ref(5025)
const saving = ref(false)

const { displayFont, setDisplayFont, fonts } = useDisplayFont()
const fontKeys = Object.keys(fonts) as DisplayFont[]
const { pref: themePref, setTheme } = useTheme()
const THEMES: { id: ThemePref; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
]
const { stableTolPct, setStableTol } = useStats()

const previewStyle = computed(() => ({
  fontFamily: fonts[displayFont.value].stack,
  fontWeight: String(fonts[displayFont.value].weight),
}))

async function show() {
  const cfg = await store.getConfig()
  host.value = cfg.meterHost
  port.value = cfg.meterPort
  open.value = true
}

// First launch / no instrument configured → prompt for one automatically.
onMounted(async () => {
  try {
    const cfg = await store.getConfig()
    if (!cfg.meterHost?.trim()) {
      host.value = ''
      port.value = cfg.meterPort || 5025
      open.value = true
    }
  } catch {
    /* server not reachable yet; the gear is always available */
  }
})

async function save() {
  if (!host.value.trim()) return
  saving.value = true
  try {
    await store.saveConfig(host.value.trim(), port.value)
    open.value = false
  } finally {
    saving.value = false
  }
}

// Close on Escape.
watch(open, (isOpen) => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') open.value = false
  }
  if (isOpen) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <button class="ghost icon" title="Settings" @click="show">
    <UiIcon name="gear" :size="17" />
  </button>

  <div v-if="open" class="backdrop" @click.self="open = false">
    <div class="dialog">
      <h2>Settings</h2>
      <p class="hint">
        Instrument address (raw SCPI socket). Display preferences apply immediately.
      </p>
      <label>
        Host
        <input v-model="host" type="text" placeholder="e.g. 192.168.1.50" spellcheck="false" />
      </label>
      <label>
        Port
        <input v-model.number="port" type="number" min="1" max="65535" />
      </label>

      <span class="seclabel">Theme</span>
      <div class="segmented full">
        <button
          v-for="t in THEMES"
          :key="t.id"
          :class="{ on: themePref === t.id }"
          @click="setTheme(t.id)"
        >
          {{ t.label }}
        </button>
      </div>

      <span class="seclabel">Stable when the last 8 readings agree within</span>
      <div class="segmented full">
        <button
          v-for="t in STABLE_TOLERANCES"
          :key="t"
          :class="{ on: stableTolPct === t }"
          @click="setStableTol(t)"
        >
          ±{{ t }}%
        </button>
      </div>

      <span class="seclabel">Display font</span>
      <div class="segmented full">
        <button
          v-for="f in fontKeys"
          :key="f"
          :class="{ on: displayFont === f }"
          @click="setDisplayFont(f)"
        >
          {{ fonts[f].label }}
        </button>
      </div>
      <div class="preview" :style="previewStyle">-12.345&nbsp;mV</div>

      <div class="actions">
        <button @click="open = false">Cancel</button>
        <button class="primary" :disabled="saving || !host.trim()" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 16px;
}
.dialog {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  padding: 22px;
  width: 400px;
  max-width: 100%;
  max-height: calc(100vh - 32px);
  overflow: auto;
}
.dialog h2 {
  margin: 0 0 4px;
  font-size: 16px;
}
.hint {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.dialog label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 14px;
}
.dialog input {
  width: 100%;
}
.seclabel {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin: 16px 0 7px;
}
.segmented.full {
  display: flex;
}
.segmented.full button {
  flex: 1;
}
.preview {
  margin-top: 10px;
  padding: 10px;
  text-align: center;
  font-size: 30px;
  line-height: 1.1;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  white-space: nowrap;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
</style>
