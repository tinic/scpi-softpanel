<script setup lang="ts">
import { useUi } from '@/composables/useUi'
import { SHORTCUT_GROUPS } from '@/composables/useShortcuts'

const { helpOpen } = useUi()
</script>

<template>
  <div class="backdrop" @click.self="helpOpen = false">
    <div class="dialog card" role="dialog" aria-label="Keyboard shortcuts">
      <div class="dhead">
        <h2>Keyboard shortcuts</h2>
        <button class="ghost icon" title="Close (Esc)" @click="helpOpen = false">✕</button>
      </div>
      <div class="groups">
        <section v-for="g in SHORTCUT_GROUPS" :key="g.title">
          <h3 class="eyebrow">{{ g.title }}</h3>
          <dl>
            <template v-for="s in g.items" :key="s.desc">
              <dt>
                <kbd v-for="k in s.keys" :key="k">{{ k }}</kbd>
              </dt>
              <dd>{{ s.desc }}</dd>
            </template>
          </dl>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--overlay);
}
.dialog {
  width: 720px;
  max-width: 100%;
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 20px 22px;
}
.dhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
h2 {
  margin: 0;
  font-size: 16px;
}
.groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px 28px;
}
h3 {
  margin-bottom: 8px;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
  margin: 0;
  align-items: center;
}
dt {
  display: flex;
  gap: 3px;
  justify-content: flex-end;
}
dd {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
</style>
