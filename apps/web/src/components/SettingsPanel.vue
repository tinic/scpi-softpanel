<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { useDisplayFont, type DisplayFont } from '@/composables/useDisplayFont'

const store = useMeterStore()
const open = ref(false)
const host = ref('')
const port = ref(5025)
const saving = ref(false)

const { displayFont, setDisplayFont, fonts } = useDisplayFont()
const fontKeys = Object.keys(fonts) as DisplayFont[]
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
  <button class="gear" title="Instrument settings" @click="show">⚙</button>

  <div v-if="open" class="backdrop" @click.self="open = false">
    <div class="dialog">
      <h2>Instrument</h2>
      <p class="hint">Address of the SCPI instrument (raw socket).</p>
      <label>
        Host
        <input v-model="host" type="text" placeholder="e.g. 192.168.1.50" spellcheck="false" />
      </label>
      <label>
        Port
        <input v-model.number="port" type="number" min="1" max="65535" />
      </label>

      <span class="seclabel">Display font</span>
      <div class="fontsel">
        <button
          v-for="f in fontKeys"
          :key="f"
          :class="{ primary: displayFont === f }"
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
.gear {
  padding: 4px 10px;
  font-size: 15px;
  line-height: 1;
  border-radius: 999px;
  color: var(--muted);
}
.gear:hover {
  color: var(--text);
}
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.dialog {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 22px;
  width: 340px;
  max-width: calc(100vw - 32px);
}
.dialog h2 {
  margin: 0 0 4px;
  font-size: 15px;
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
  margin-bottom: 7px;
}
.fontsel {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fontsel button {
  padding: 5px 11px;
  font-size: 12px;
}
.preview {
  margin-top: 12px;
  padding: 10px;
  text-align: center;
  font-size: 30px;
  line-height: 1.1;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  white-space: nowrap;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
