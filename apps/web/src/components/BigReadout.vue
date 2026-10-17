<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useUi } from '@/composables/useUi'
import LiveReading from './LiveReading.vue'
import UiIcon from './UiIcon.vue'

/** Full-window "big digits" view for reading the bench from across the room. */
const { bigMode } = useUi()

function close(): void {
  bigMode.value = false
}

onMounted(() => {
  // Real fullscreen where the browser allows it; the overlay works either way.
  document.documentElement.requestFullscreen?.().catch(() => {})
})
onBeforeUnmount(() => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
})
</script>

<template>
  <div class="big" role="dialog" aria-label="Big digits" @dblclick="close">
    <button class="ghost icon close" title="Exit (Esc or B)" @click="close">
      <UiIcon name="close" :size="20" />
    </button>
    <LiveReading big />
  </div>
</template>

<style scoped>
.big {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 4vh 5vw;
  background: var(--bg);
}
.big :deep(.live) {
  height: auto;
  gap: 2vh;
}
.close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 40px;
  height: 40px;
}
</style>
