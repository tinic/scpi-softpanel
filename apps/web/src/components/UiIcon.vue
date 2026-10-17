<script setup lang="ts">
// Small stroke icon set (24×24 grid, currentColor), drawn inline so the app stays
// self-contained/offline.
type IconName =
  | 'sun'
  | 'moon'
  | 'auto'
  | 'keyboard'
  | 'gear'
  | 'download'
  | 'image'
  | 'flag'
  | 'reset'
  | 'expand'
  | 'pause'
  | 'record'
  | 'stop'
  | 'trash'
  | 'eye'
  | 'layers'
  | 'close'
  | 'refresh'
  | 'zoom-out'
  | 'speaker'
  | 'speaker-off'

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 16 })

const PATHS: Record<IconName, string[]> = {
  sun: [
    'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
    'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  ],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  auto: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M12 3v18', 'M12 3a9 9 0 0 1 0 18z'],
  keyboard: [
    'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
    'M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8',
  ],
  gear: [
    'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
    'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  ],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  image: [
    'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M8.5 7.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
    'M21 15l-5-5L5 20',
  ],
  flag: ['M5 21V4', 'M5 4h12l-2 4 2 4H5'],
  reset: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
  expand: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
  pause: ['M8 5v14', 'M16 5v14'],
  record: ['M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12'],
  stop: ['M7 7h10v10H7z'],
  trash: ['M4 7h16', 'M10 11v6M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
  layers: ['M12 3l9 5-9 5-9-5 9-5z', 'M3 13l9 5 9-5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  speaker: ['M4 9v6h4l5 4V5L8 9z', 'M16.5 9.5a3.5 3.5 0 0 1 0 5', 'M19.5 6.5a7.5 7.5 0 0 1 0 11'],
  'speaker-off': ['M4 9v6h4l5 4V5L8 9z', 'M16 9.5l5 5M21 9.5l-5 5'],
  'zoom-out': ['M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13', 'M20 20l-4.8-4.8', 'M7.5 10.5h6'],
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, i) in PATHS[name]" :key="i" :d="d" />
  </svg>
</template>
