import { useEffect } from 'react'
import type { ProfileColor } from '../api.ts'
import { type Theme, usePreferences } from './preferences.ts'
import { useCurrentProfile } from './profiles.ts'

// Mon compte › Affichage: Clair, Sombre or Poudré; the open profile's colour is the brand's, in place of the theme's
// own. They set data-theme and data-accent on <html> (see styles/tokens.css); public/theme.js applies them before the
// first paint, the colour from this device's copy.
export const ACCENT_KEY = 'hodi:accent'

// The browser's bar matches the top of the page.
const BAR_COLOURS = { dark: '#131314', light: '#F3EEE4', powder: '#191215' }

const keep = (accent: ProfileColor | null) => {
  try {
    if (accent) localStorage.setItem(ACCENT_KEY, accent)
    else localStorage.removeItem(ACCENT_KEY)
  } catch {
    // Storage refused: the colour still applies once the profiles have arrived.
  }
}

const apply = (theme: Theme, accent: ProfileColor | null) => {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  if (accent) root.dataset.accent = accent
  else delete root.dataset.accent
  keep(accent)

  // Each tag answers its own media query; a chosen theme sets both.
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    const own = meta.getAttribute('media')?.includes('light') ? 'light' : 'dark'
    meta.setAttribute('content', BAR_COLOURS[theme === 'system' ? own : theme])
  })
}

export const useTheme = () => {
  const { theme } = usePreferences()
  const profile = useCurrentProfile()
  // Until the profiles arrive, the colour public/theme.js put back stays.
  const ready = profile !== null
  const accent = profile?.color ?? null

  useEffect(() => {
    if (ready) apply(theme, accent)
    else apply(theme, (document.documentElement.dataset.accent as ProfileColor | undefined) ?? null)
  }, [theme, accent, ready])
}

// The theme shown: a profile that never chose is on its device's.
export const shownTheme = (theme: Theme) =>
  theme !== 'system' ? theme : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
