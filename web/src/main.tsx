import { Capacitor } from '@capacitor/core'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { setupNative } from './platform/native.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

setupNative()
ensureKatex()
setupTheme()

if (
  'serviceWorker' in navigator &&
  window.location.protocol === 'https:' &&
  !Capacitor.isNativePlatform() &&
  !('__TAURI_INTERNALS__' in window)
) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
