import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
// Applies the saved/system theme to <html> before the first paint.
import './composables/useTheme'

createApp(App).use(createPinia()).mount('#app')
