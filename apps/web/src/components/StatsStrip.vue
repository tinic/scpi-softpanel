<script setup lang="ts">
import { computed } from 'vue'
import { useDisplay } from '@/composables/useDisplay'
import { useStats } from '@/composables/useStats'
import UiIcon from './UiIcon.vue'

/** N · mean · σ · min · max · p-p since the last reset, in the display unit. */

const { channel } = useDisplay()
const { summary, span, reset } = useStats()

function fmtSpan(s: number): string {
  if (s < 60) return `${s.toFixed(0)} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const cells = computed(() => {
  const s = summary.value
  if (!s) return null
  const ch = channel.value
  const f = (v: number, delta = false) => {
    const x = ch.format(v, { delta })
    return `${x.sign}${x.text} ${x.unit}`.trim()
  }
  // σ relative to the mean, in ppm — the metrology view of noise.
  const ppm = s.mean !== 0 && Number.isFinite(s.mean) ? (s.std / Math.abs(s.mean)) * 1e6 : null
  return [
    { k: 'mean', label: 'Mean', v: f(s.mean) },
    {
      k: 'std',
      label: 'σ',
      v: s.n > 1 ? f(s.std, true) : '—',
      title:
        ppm != null && s.n > 1 ? `${ppm < 10 ? ppm.toFixed(2) : ppm.toFixed(0)} ppm of mean` : '',
    },
    { k: 'min', label: 'Min', v: f(s.min) },
    { k: 'max', label: 'Max', v: f(s.max) },
    { k: 'pp', label: 'P-P', v: f(s.pp, true) },
  ]
})
</script>

<template>
  <div class="strip">
    <div class="cell n">
      <span class="lbl">N</span>
      <span class="val mono">{{ summary ? summary.n.toLocaleString() : '—' }}</span>
      <span class="sub">{{ summary ? fmtSpan(span) : '' }}</span>
    </div>
    <template v-if="cells">
      <div v-for="c in cells" :key="c.k" class="cell" :title="c.title">
        <span class="lbl" :class="{ greek: c.k === 'std' }">{{ c.label }}</span>
        <span class="val mono">{{ c.v }}</span>
      </div>
    </template>
    <div v-else class="cell empty">No readings yet</div>
    <button class="ghost icon reset" title="Reset statistics (X)" @click="reset">
      <UiIcon name="reset" :size="15" />
    </button>
  </div>
</template>

<style scoped>
.strip {
  display: grid;
  grid-template-columns: minmax(64px, 0.7fr) repeat(5, minmax(0, 1fr)) auto;
  align-items: center;
  gap: 4px 12px;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.lbl {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}
.lbl.greek {
  text-transform: none;
  font-size: 12px;
  line-height: 1;
}
.val {
  font-weight: 800;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  font-size: 11px;
  color: var(--faint);
}
.empty {
  grid-column: span 5;
  color: var(--faint);
  font-size: 13px;
}
.reset {
  align-self: center;
}
@media (max-width: 640px) {
  .strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .reset {
    position: absolute;
    right: 10px;
    bottom: 10px;
  }
  .empty {
    grid-column: span 2;
  }
}
</style>
