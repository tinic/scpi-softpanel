<script setup lang="ts">
import { ref, watch } from 'vue'
import { useMeterStore } from '@/stores/meter'

const store = useMeterStore()
const open = ref(false)
const host = ref('')
const port = ref(5025)
const saving = ref(false)

async function show() {
  const cfg = await store.getConfig()
  host.value = cfg.meterHost
  port.value = cfg.meterPort
  open.value = true
}

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
      <p class="hint">Address of the SCPI instrument (raw socket). The app reconnects on save.</p>
      <label>
        Host
        <input v-model="host" type="text" placeholder="192.168.1.166" spellcheck="false" />
      </label>
      <label>
        Port
        <input v-model.number="port" type="number" min="1" max="65535" />
      </label>
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
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
