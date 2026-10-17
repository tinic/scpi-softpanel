<script setup lang="ts">
import { ref } from 'vue'

/** A titled, collapsible card in the control rail; remembers whether it's open. */
const props = withDefaults(
  defineProps<{ id: string; title: string; defaultOpen?: boolean; collapsible?: boolean }>(),
  { defaultOpen: true, collapsible: true },
)

const KEY = `scpi.rail.${props.id}`
function load(): boolean {
  try {
    const v = localStorage.getItem(KEY)
    return v == null ? props.defaultOpen : v === '1'
  } catch {
    return props.defaultOpen
  }
}
const open = ref(!props.collapsible || load())
function toggle(): void {
  if (!props.collapsible) return
  open.value = !open.value
  try {
    localStorage.setItem(KEY, open.value ? '1' : '0')
  } catch {
    /* not persisted */
  }
}
</script>

<template>
  <section class="card rail-section" :class="{ open }">
    <header>
      <button
        v-if="collapsible"
        class="head"
        :aria-expanded="open"
        :aria-controls="`rail-${id}`"
        @click="toggle"
      >
        <span class="chev" aria-hidden="true">▸</span>
        <h2 class="eyebrow">{{ title }}</h2>
      </button>
      <h2 v-else class="eyebrow head static">{{ title }}</h2>
      <div class="badge"><slot name="badge" /></div>
    </header>
    <div v-show="open" :id="`rail-${id}`" class="body"><slot /></div>
  </section>
</template>

<style scoped>
.rail-section {
  padding: 4px 16px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 42px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  margin: 0;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  flex: 1;
  text-align: left;
}
.head:hover:not(:disabled) {
  background: none;
}
.head:hover .eyebrow,
.head:hover .chev {
  color: var(--text);
}
.head.static {
  cursor: default;
}
.chev {
  display: inline-block;
  font-size: 12px;
  color: var(--faint);
  transition: transform 0.15s ease;
}
.open .chev {
  transform: rotate(90deg);
}
.badge {
  display: flex;
  align-items: center;
  gap: 6px;
}
.body {
  padding: 2px 0 16px;
}
</style>
