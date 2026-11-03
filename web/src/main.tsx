import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { OverlayScrollbars } from 'overlayscrollbars'
import App from './App.tsx'
import { loadSanitizer, warmDeferred } from './lib/deferred.ts'
import { languageReady } from './lib/i18n.ts'
import ConfirmDialog from './ui/ConfirmDialog.tsx'
import Toaster from './ui/Toaster.tsx'
import './styles/index.ts'

warmDeferred()
// Opened on an article: its sanitizer comes now, with the article's text, rather than once the reader asks.
if (location.hash.startsWith('#/article/')) void loadSanitizer().catch(() => {})

const root = document.getElementById('root')

if (!root) {
  throw new Error('Missing #root element')
}

// Makes the app installable and keeps opened articles readable offline (see public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}

// The page's own scrollbar floats over the content too (phones and tablets held upright scroll the page),
// so it never takes room or shifts the layout. Wherever the system's scrollbars already float (phones,
// macOS), it stands aside. Not decided on the pointer: a Windows touch laptop or a browser emulating a
// tablet still draws classic scrollbars.
OverlayScrollbars(
  { target: document.body, cancel: { nativeScrollbarsOverlaid: true } },
  { scrollbars: { theme: 'os-theme-hodi', autoHide: 'scroll', autoHideDelay: 800 }, overflow: { x: 'hidden' } }
)

// In French at once; in another language, once its texts came, so the first screen never changes language.
void languageReady.then(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
      <Toaster />
      <ConfirmDialog />
    </StrictMode>
  )
)
