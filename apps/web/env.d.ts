/// <reference types="vite/client" />

// Injected at build time by vite.config.ts `define`.
declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
