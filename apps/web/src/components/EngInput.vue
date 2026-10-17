<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { parseEng } from '@/lib/format'

/**
 * Number entry that speaks engineering notation: type "2.95m", "4k7" or "1e-3";
 * shows `display(value)` when not being edited. Commits on Enter/blur; Escape
 * reverts. An empty field commits null when `nullable`.
 */
const props = withDefaults(
  defineProps<{
    modelValue: number | null
    /** Formats the committed value for display, e.g. "2.95m". */
    display?: (v: number | null) => string
    /** Unit labels allowed after the number (stripped before parsing). */
    units?: string[]
    /** Suffix shown inside the field. */
    unit?: string
    placeholder?: string
    nullable?: boolean
    label?: string
  }>(),
  {
    display: (v: number | null) => (v == null ? '' : String(v)),
    units: () => [],
    unit: '',
    placeholder: '',
    nullable: false,
    label: '',
  },
)
const emit = defineEmits<{ 'update:modelValue': [v: number | null] }>()

const text = ref(props.display(props.modelValue))
const editing = ref(false)
watch(
  () => [props.modelValue, props.display] as const,
  () => {
    if (!editing.value) text.value = props.display(props.modelValue)
  },
)

const invalid = computed(() => {
  const t = text.value.trim()
  if (!t) return !props.nullable
  return parseEng(t, props.units) === null
})

function commit(): void {
  editing.value = false
  const t = text.value.trim()
  if (!t && props.nullable) {
    emit('update:modelValue', null)
    return
  }
  const v = parseEng(t, props.units)
  if (v === null) {
    text.value = props.display(props.modelValue)
    return
  }
  emit('update:modelValue', v)
  text.value = props.display(v)
}

function revert(e: KeyboardEvent): void {
  text.value = props.display(props.modelValue)
  editing.value = false
  ;(e.target as HTMLInputElement).blur()
}
</script>

<template>
  <label class="eng" :class="{ invalid: editing && invalid }">
    <span v-if="label" class="lbl">{{ label }}</span>
    <span class="field">
      <input
        v-model="text"
        type="text"
        inputmode="decimal"
        spellcheck="false"
        autocomplete="off"
        :placeholder="placeholder"
        @focus="editing = true"
        @blur="commit"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        @keydown.esc.prevent="revert"
      />
      <span v-if="unit" class="unit">{{ unit }}</span>
    </span>
  </label>
</template>

<style scoped>
.eng {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.lbl {
  font-size: 11px;
  color: var(--muted);
}
.field {
  position: relative;
  display: flex;
}
input {
  width: 100%;
  font-family: var(--mono);
  font-size: 13px;
  padding-right: 34px;
}
.unit {
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--faint);
  pointer-events: none;
}
.invalid input {
  border-color: var(--bad);
  box-shadow: 0 0 0 3px var(--bad-soft);
}
</style>
