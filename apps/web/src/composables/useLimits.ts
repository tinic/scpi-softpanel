import { computed, reactive, ref, watch } from 'vue'
import { useMeterStore } from '@/stores/meter'
import { useDisplay } from '@/composables/useDisplay'
import { useMath } from '@/composables/useMath'
import { evaluate, NO_LIMITS, type Limits, type Verdict } from '@/lib/limits'
import { alarmTone } from '@/lib/tone'

// Pass/fail limits. Stored per function + math mode, since a limit is a number in
// that channel's display unit (a 5 V limit means nothing once math shows dBm).
// Module-level singletons; `installLimitWatcher` (called once from App) does the
// per-reading counting and alarms so they run regardless of what's on screen.

const KEY = 'scpi.limits'
const PREFS_KEY = 'scpi.limitAlarm'

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? { ...fallback, ...JSON.parse(v) } : fallback
  } catch {
    return fallback
  }
}
function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* not persisted */
  }
}

const byKey = ref<Record<string, Limits>>(load(KEY, {}))
const alarm = reactive(load(PREFS_KEY, { sound: true, notify: false }))
const counts = reactive({ pass: 0, lo: 0, hi: 0 })
let installed = false

export function useLimits() {
  const store = useMeterStore()
  const { channel } = useDisplay()
  const math = useMath()

  const key = computed(() => {
    const fn = store.state?.function
    return fn ? `${fn}|${math.active.value ? math.config.value.mode : 'off'}` : ''
  })
  const limits = computed<Limits>(() => byKey.value[key.value] ?? NO_LIMITS)
  const active = computed(() => evaluate(0, limits.value) !== null)

  /** Verdict for the newest reading of the current function. */
  const verdict = computed<Verdict | null>(() => {
    const r = store.lastReading
    if (!r || r.function !== store.state?.function) return null
    return evaluate(channel.value.value(r), limits.value)
  })

  function update(patch: Partial<Limits>): void {
    if (!key.value) return
    byKey.value = { ...byKey.value, [key.value]: { ...limits.value, ...patch } }
    save(KEY, byKey.value)
    resetCounts()
  }

  function resetCounts(): void {
    counts.pass = counts.lo = counts.hi = 0
  }

  function setAlarm(patch: Partial<typeof alarm>): void {
    Object.assign(alarm, patch)
    save(PREFS_KEY, { ...alarm })
    if (patch.notify && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }

  return { limits, active, verdict, counts, alarm, update, resetCounts, setAlarm }
}

/** Count every reading against the limits and raise the alarm on a pass→fail edge. */
export function installLimitWatcher(): void {
  if (installed) return
  installed = true
  const store = useMeterStore()
  const { verdict } = useLimits()
  let last: Verdict | null = null
  watch(
    () => store.lastReading?.ts,
    () => {
      const v = verdict.value
      if (v) counts[v]++
      if (v && v !== 'pass' && last !== 'lo' && last !== 'hi') raise(v)
      last = v
    },
  )
}

function raise(v: Verdict): void {
  if (alarm.sound) alarmTone()
  if (
    alarm.notify &&
    document.hidden &&
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    new Notification('SCPI SoftPanel: limit failed', {
      body: v === 'hi' ? 'Reading above the high limit' : 'Reading below the low limit',
      tag: 'scpi-limit',
    })
  }
}
