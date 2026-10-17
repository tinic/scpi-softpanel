<script setup lang="ts">
// Drawn keypad symbols for the functions whose standard DMM markings have no good
// Unicode equivalent: the diode (filled triangle against a bar, on a lead) and
// continuity (a dot radiating sound arcs, as on the beeper key of most meters).
defineProps<{ fn: 'CONT' | 'DIOD' }>()
</script>

<template>
  <svg
    v-if="fn === 'DIOD'"
    class="glyph"
    viewBox="0 0 28 16"
    width="28"
    height="16"
    fill="currentColor"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <path d="M2 8h8M18 8h8" fill="none" />
    <path d="M10 3.2v9.6L17.6 8z" stroke-linejoin="round" stroke-width="1.2" />
    <path d="M18.2 3v10" fill="none" />
  </svg>
  <svg
    v-else
    class="glyph"
    viewBox="0 -1 20 18"
    width="20"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <circle cx="4" cy="8" r="2.2" fill="currentColor" stroke="none" />
    <path d="M7.45 5.1A4.5 4.5 0 0 1 7.45 10.9" />
    <path d="M10.5 2.55A8.5 8.5 0 0 1 10.5 13.45" />
    <path d="M13.6 0A12.5 12.5 0 0 1 13.6 16" />
  </svg>
</template>

<style scoped>
.glyph {
  display: inline-block;
  vertical-align: middle;
}
</style>
