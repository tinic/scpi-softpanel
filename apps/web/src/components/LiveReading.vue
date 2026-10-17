<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { useDisplay } from '@/composables/useDisplay'
import { useDisplayFont } from '@/composables/useDisplayFont'
import { useHold } from '@/composables/useHold'
import { useLimits } from '@/composables/useLimits'
import { useStats } from '@/composables/useStats'
import { useUi } from '@/composables/useUi'
import { blipTone, onToneBlocked, setToneVolume, startTone, stopTone } from '@/lib/tone'
import AnnunciatorStrip from './AnnunciatorStrip.vue'
import StatsStrip from './StatsStrip.vue'
import UiIcon from './UiIcon.vue'

const props = withDefaults(defineProps<{ big?: boolean }>(), { big: false })

const store = useMeterStore()
const { channel } = useDisplay()
const { held, toggle: toggleHold } = useHold()
const { verdict } = useLimits()
const { stable } = useStats()
const { bigMode } = useUi()

// Display font is a preference; expose it as CSS vars on the readout root.
const { displayFont, fonts } = useDisplayFont()
const fontVars = computed(() => ({
  '--display-font': fonts[displayFont.value].stack,
  '--display-weight': String(fonts[displayFont.value].weight),
}))

// -- continuity tone -------------------------------------------------------
// Follows the meter's own threshold (CONT:THR:VAL, in state); 50 Ω is its default.
// Only the docked readout drives the tone (the big view is a second copy).
const threshold = computed(() => store.state?.contThreshold ?? 50)
const SOUND_PREF_KEY = 'scpi.contSound'
const VOLUME_PREF_KEY = 'scpi.contVolume'

const soundOn = ref(localStorage.getItem(SOUND_PREF_KEY) !== 'off')
function toggleSound() {
  soundOn.value = !soundOn.value
  localStorage.setItem(SOUND_PREF_KEY, soundOn.value ? 'on' : 'off')
}

const storedVol = Number(localStorage.getItem(VOLUME_PREF_KEY))
const volPct = ref(Number.isFinite(storedVol) && storedVol > 0 ? storedVol : 40)
setToneVolume(volPct.value / 100)
function onVolume() {
  localStorage.setItem(VOLUME_PREF_KEY, String(volPct.value))
  setToneVolume(volPct.value / 100)
}
// Preview on release so the level can be judged without holding a short.
function onVolumeSet() {
  if (soundOn.value) blipTone()
}

// True while the browser's autoplay policy keeps audio suspended (i.e. the page
// hasn't seen a user gesture since load); the pill shows a hint in that state.
const audioBlocked = ref(false)
const unsubBlocked = onToneBlocked((b) => (audioBlocked.value = b))

// Stop the tone if readings stall (poll stopped, link lost) while shorted —
// each closed-circuit reading re-arms this.
let staleTimer: ReturnType<typeof setTimeout> | null = null

if (!props.big) {
  watch([() => store.lastReading, () => store.state?.function, soundOn], () => {
    const r = store.lastReading
    const closed =
      soundOn.value &&
      store.state?.function === 'CONT' &&
      r?.function === 'CONT' &&
      Number.isFinite(r.value) &&
      r.value < threshold.value
    if (staleTimer) clearTimeout(staleTimer)
    if (closed) {
      startTone()
      staleTimer = setTimeout(stopTone, 1500)
    } else {
      stopTone()
    }
  })
}

onBeforeUnmount(() => {
  if (staleTimer) clearTimeout(staleTimer)
  unsubBlocked()
  if (!props.big) stopTone()
})

// -- the value ---------------------------------------------------------------
const shown = computed(() => held.value ?? store.lastReading)
const isCont = computed(() => shown.value?.function === 'CONT')

const display = computed(() => {
  const r = shown.value
  if (!r || r.function !== store.state?.function) return { sign: '', text: '––––', unit: '' }
  const ch = channel.value
  if (r.overload && !isCont.value) return { sign: '', text: 'OL', unit: ch.format(0).unit }
  return ch.format(ch.value(r))
})

const overload = computed(() => shown.value?.overload ?? false)
// An open circuit is continuity's resting state, not an alarm — styled muted, not warn.
const contOpen = computed(() => overload.value && isCont.value)
const stale = computed(() => !store.instrumentConnected && !!store.lastReading)
</script>

<template>
  <div
    class="live"
    :class="{
      big: props.big,
      pass: verdict === 'pass',
      fail: verdict === 'lo' || verdict === 'hi',
    }"
    :style="fontVars"
  >
    <div class="head">
      <div class="title">
        <span class="fn">{{ channel.label }}</span>
        <span v-if="channel.mathTag" class="math">{{ channel.mathTag }}</span>
        <template v-if="store.state?.function === 'CONT' && !props.big">
          <button
            class="snd"
            :class="{ on: soundOn && !audioBlocked, blocked: soundOn && audioBlocked }"
            :title="
              soundOn
                ? audioBlocked
                  ? 'Audio blocked by the browser — click anywhere to enable'
                  : 'Continuity tone: on'
                : 'Continuity tone: muted'
            "
            @click="toggleSound"
          >
            <UiIcon :name="soundOn ? 'speaker' : 'speaker-off'" :size="14" />
          </button>
          <input
            v-model.number="volPct"
            class="vol"
            type="range"
            min="5"
            max="100"
            step="5"
            title="Continuity tone volume"
            :disabled="!soundOn"
            @input="onVolume"
            @change="onVolumeSet"
          />
        </template>
      </div>
      <div class="tools">
        <span
          v-if="stable !== null"
          class="stable"
          :class="{ yes: stable }"
          :title="
            stable
              ? 'The last readings agree within the stability tolerance'
              : 'Reading is still moving'
          "
        >
          <span class="sdot" />{{ stable ? 'Stable' : 'Settling' }}
        </span>
        <template v-if="!props.big">
          <button
            class="ghost icon"
            :class="{ active: !!held }"
            :title="held ? 'Release hold (H)' : 'Hold the display (H)'"
            @click="toggleHold"
          >
            <UiIcon name="pause" :size="15" />
          </button>
          <button class="ghost icon" title="Big digits (B)" @click="bigMode = true">
            <UiIcon name="expand" :size="15" />
          </button>
        </template>
      </div>
    </div>

    <div
      class="value"
      :class="{ overload: overload && !contOpen, open: contOpen, stale, held: !!held }"
    >
      <span class="mag">
        <span class="sign">{{ display.sign }}</span>
        <span class="num">{{ display.text }}</span>
      </span>
      <span class="unit">{{ display.unit }}</span>
    </div>

    <AnnunciatorStrip />

    <div class="stats"><StatsStrip /></div>
  </div>
</template>

<style scoped>
.live {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--readout-bg);
  border-radius: inherit;
  transition: box-shadow 0.2s;
}
.live.fail {
  box-shadow: inset 0 0 0 2px var(--bad);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 0 22px;
  min-height: 44px;
}
.title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}
.fn {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.math {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 800;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 2px 7px;
  border-radius: 5px;
}
.tools {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tools .active {
  color: var(--warn);
  background: var(--warn-soft);
}
.stable {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.sdot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--faint);
}
.stable.yes {
  color: var(--good);
}
.stable.yes .sdot {
  background: var(--good);
  border-color: var(--good);
  box-shadow: 0 0 8px var(--good);
}
.snd {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  font-size: 12px;
  line-height: 1;
  border-radius: 999px;
  color: var(--muted);
}
.snd.on {
  color: var(--accent);
  border-color: var(--accent);
}
.snd.blocked {
  color: var(--warn);
  border-color: var(--warn);
}
.vol {
  appearance: none;
  width: 88px;
  height: 4px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 2px;
  background: var(--border-strong);
  cursor: pointer;
}
.vol::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
}
.vol::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: none;
  border-radius: 50%;
  background: var(--accent);
}
.vol:disabled {
  opacity: 0.4;
  cursor: default;
}

.value {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 14px;
  padding: 18px 16px 22px;
  white-space: nowrap;
  min-height: 150px;
  align-content: center;
  flex-wrap: wrap;
}
.mag {
  display: inline-flex;
  align-items: baseline;
  font-family: var(--display-font, var(--mono));
  font-weight: var(--display-weight, 800);
  font-size: clamp(56px, 8.2vw, 112px);
  line-height: 1;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
  transition: color 0.15s;
}
/* Fixed-width sign column so digits don't shift when the reading crosses zero. */
.sign {
  display: inline-block;
  width: 0.6ch;
  text-align: center;
}
.unit {
  font-family: var(--display-font, var(--mono));
  font-weight: var(--display-weight, 800);
  font-size: clamp(24px, 3.2vw, 42px);
  color: var(--accent);
}
.live.pass .mag {
  color: var(--good);
}
.live.fail .mag {
  color: var(--bad);
}
.value.overload .mag {
  color: var(--warn);
}
.value.open .mag,
.value.stale .mag {
  color: var(--faint);
}
.value.held .mag {
  text-decoration: underline 3px var(--warn);
  text-underline-offset: 10px;
}
.stats {
  position: relative;
  margin-top: 18px;
  padding: 14px 16px 14px 22px;
  border-top: 1px solid var(--border);
}

/* Big-digits overlay variant: fill the viewport. */
.live.big {
  background: none;
}
.live.big .head {
  padding: 0;
}
.live.big .fn {
  font-size: clamp(14px, 1.6vw, 22px);
}
.live.big .value {
  min-height: 0;
}
.live.big .mag {
  font-size: clamp(80px, 17vw, 380px);
}
.live.big .unit {
  font-size: clamp(32px, 6vw, 130px);
}
.live.big .stats {
  border-top-color: var(--border);
}
.live.big .stats :deep(.val) {
  font-size: clamp(14px, 1.6vw, 24px);
}
.live.big :deep(.ann li) {
  font-size: clamp(11px, 1.1vw, 16px);
  padding: 6px 10px;
}
</style>
