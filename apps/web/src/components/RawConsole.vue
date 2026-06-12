<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useMeterStore } from '@/stores/meter'

const store = useMeterStore()
const cmd = ref('')
const expectReply = ref(true)
const logEl = ref<HTMLDivElement | null>(null)

function send() {
  const text = cmd.value.trim()
  if (!text) return
  // A command ending in '?' is a query by convention; honor the toggle otherwise.
  store.raw(text, expectReply.value || text.endsWith('?'))
  cmd.value = ''
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

watch(
  () => store.consoleLog.length,
  () => {
    nextTick(() => {
      if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
    })
  },
)
</script>

<template>
  <div class="console">
    <div ref="logEl" class="log">
      <div v-for="(e, i) in store.consoleLog" :key="i" class="line" :class="e.direction">
        <span class="t">{{ fmtTime(e.ts) }}</span>
        <span class="d">{{ e.direction }}</span>
        <span class="txt">{{ e.text }}</span>
      </div>
      <div v-if="store.consoleLog.length === 0" class="empty">No traffic yet.</div>
    </div>
    <div class="entry">
      <input
        v-model="cmd"
        type="text"
        placeholder="Raw SCPI, e.g. *IDN?  or  CONF:VOLT:DC"
        spellcheck="false"
        @keyup.enter="send"
      />
      <label class="chk"><input v-model="expectReply" type="checkbox" />reply</label>
      <button class="primary" @click="send">Send</button>
      <button class="danger" @click="store.clearConsole()">Clear</button>
    </div>
  </div>
</template>

<style scoped>
.console {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.log {
  height: 200px;
  overflow-y: auto;
  background: #0a0e14;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.5;
}
.line {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}
.line .t {
  color: #586069;
}
.line .d {
  width: 28px;
  flex-shrink: 0;
  text-transform: uppercase;
  font-size: 10px;
  padding-top: 1px;
}
.line.tx .d {
  color: var(--accent);
}
.line.rx .txt {
  color: var(--good);
}
.line.rx .d {
  color: var(--good);
}
.line.error .txt {
  color: var(--bad);
}
.line.info .txt,
.line.info .d {
  color: var(--muted);
}
.empty {
  color: var(--muted);
}
.entry {
  display: flex;
  gap: 8px;
  align-items: center;
}
.entry input[type='text'] {
  flex: 1;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 12px;
}
</style>
