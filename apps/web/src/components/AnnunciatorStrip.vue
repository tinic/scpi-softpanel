<script setup lang="ts">
import { computed } from 'vue'
import { FUNCTION_INFO } from '@scpi/shared'
import { useMeterStore } from '@/stores/meter'
import { useDisplay } from '@/composables/useDisplay'
import { useHold } from '@/composables/useHold'
import { useLimits } from '@/composables/useLimits'
import { formatRangeLabel } from '@/lib/format'

/**
 * The DMM-LCD annunciator strip: every mode indicator is always present and lights
 * up when active, so the instrument's setup reads at a glance without scanning the
 * control rail. Contextual ones (NPLC, filter, gate) appear only where they apply.
 */

const store = useMeterStore()
const { channel } = useDisplay()
const { held } = useHold()
const { active: limitsOn, verdict } = useLimits()

type Tone = 'accent' | 'good' | 'bad' | 'warn' | 'rec'
interface Ann {
  id: string
  label: string
  on: boolean
  tone?: Tone
  title: string
}

const items = computed<Ann[]>(() => {
  const st = store.state
  const fn = st?.function
  const info = fn ? FUNCTION_INFO[fn] : null
  const out: Ann[] = []

  if (info?.supportsRange) {
    const manual = st?.autoRange === false && st.range && st.range !== 'AUTO'
    out.push({
      id: 'range',
      label: manual ? formatRangeLabel(Number(st!.range), info.unit) : 'AUTO',
      on: true,
      title: manual ? 'Manual range' : 'Autorange',
    })
  }
  if (info?.supportsNplc && st?.nplc != null) {
    out.push({ id: 'nplc', label: `NPLC ${st.nplc}`, on: true, title: 'Integration time' })
  }
  if ((fn === 'VOLT:AC' || fn === 'CURR:AC') && st?.acBandwidth != null) {
    out.push({ id: 'filt', label: `FILT ${st.acBandwidth}Hz`, on: true, title: 'AC filter' })
  }
  if ((fn === 'FREQ' || fn === 'PER') && st?.freqAperture != null) {
    const a = st.freqAperture
    out.push({
      id: 'gate',
      label: `GATE ${a < 1 ? `${Math.round(a * 1000)}ms` : `${a}s`}`,
      on: true,
      title: 'Gate time',
    })
  }
  if (info?.sense) {
    out.push({ id: 'rel', label: 'REL', on: !!st?.nullEnabled, title: 'Relative (null) offset' })
  }
  out.push({
    id: 'math',
    label: channel.value.mathTag || 'MATH',
    on: !!channel.value.mathTag,
    title: 'Math channel',
  })
  out.push({ id: 'hold', label: 'HOLD', on: !!held.value, tone: 'warn', title: 'Display hold' })
  const v = verdict.value
  out.push({
    id: 'limit',
    label: !limitsOn.value
      ? 'LIMIT'
      : v === 'pass'
        ? 'PASS'
        : v === 'hi'
          ? 'HI'
          : v === 'lo'
            ? 'LO'
            : 'LIMIT',
    on: limitsOn.value,
    tone: v === 'pass' ? 'good' : v ? 'bad' : 'accent',
    title: 'Limit test',
  })
  out.push({
    id: 'rec',
    label: 'REC',
    on: !!st?.recording,
    tone: 'rec',
    title: 'Recording to disk',
  })
  const running = !!st?.polling && !!st?.connected
  out.push({
    id: 'run',
    label: running ? 'RUN' : 'STOP',
    on: true,
    tone: running ? 'good' : 'warn',
    title: running ? 'Acquiring' : 'Acquisition stopped',
  })
  return out
})
</script>

<template>
  <ul class="ann" aria-label="Instrument status">
    <li
      v-for="a in items"
      :key="a.id"
      :class="[a.on ? 'on' : 'off', a.on ? (a.tone ?? 'accent') : '']"
      :title="a.title"
    >
      {{ a.label }}
    </li>
  </ul>
</template>

<style scoped>
.ann {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ann li {
  font-family: var(--mono);
  font-weight: 800;
  font-size: 11px;
  letter-spacing: 0.06em;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  white-space: nowrap;
  transition:
    color 0.15s,
    background-color 0.15s,
    border-color 0.15s;
}
.ann li.off {
  color: var(--faint);
  opacity: 0.55;
}
.ann li.accent {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}
.ann li.good {
  color: var(--good);
  background: var(--good-soft);
  border-color: color-mix(in srgb, var(--good) 35%, transparent);
}
.ann li.bad {
  color: var(--bad);
  background: var(--bad-soft);
  border-color: color-mix(in srgb, var(--bad) 45%, transparent);
}
.ann li.warn {
  color: var(--warn);
  background: var(--warn-soft);
  border-color: color-mix(in srgb, var(--warn) 35%, transparent);
}
.ann li.rec {
  color: #fff;
  background: var(--rec);
  border-color: var(--rec);
}
</style>
