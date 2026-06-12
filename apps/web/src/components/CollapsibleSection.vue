<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{ title: string; defaultOpen?: boolean }>(), {
  defaultOpen: true,
})
const open = ref(props.defaultOpen)
</script>

<template>
  <div class="collapsible">
    <button class="head" :aria-expanded="open" @click="open = !open">
      <span class="chev" :class="{ open }">▸</span>
      <h2>{{ title }}</h2>
    </button>
    <div v-show="open" class="body"><slot /></div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  text-align: left;
}
.head h2 {
  margin: 0;
}
.head:hover .chev,
.head:hover h2 {
  color: var(--text);
}
.chev {
  display: inline-block;
  font-size: 11px;
  color: var(--muted);
  transition: transform 0.15s ease;
}
.chev.open {
  transform: rotate(90deg);
}
.body {
  margin-top: 14px;
}
</style>
