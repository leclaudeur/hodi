import { useEffect } from 'react'
import type { ProfileColor } from '../api.ts'
import { type Theme, usePreferences } from './preferences.ts'
import { useProfiles } from './profiles.ts'

// Mon compte › Affichage: Clair, Sombre or Poudré; the open profile's colour is the brand's, in place of the theme's
// own. They set data-theme and data-accent on <html> (see styles/tokens.css); public/theme.js applies them before the
// first paint, the colour from this device's copy.
export const ACCENT_KEY = 'hodi:accent'

// The browser's bar matches the top of the page.
const BAR_COLOURS = { dark: '#131314', light: '#F3EEE4', powder: '#191215' }

// This device's copy of the colour, for the next start. null forgets it: no profile open, or signed out, so the
// next person does not see who read here last.
export const keepAccent = (accent: ProfileColor | null) => {
  try {
    if (accent) localStorage.setItem(ACCENT_KEY, accent)
    else localStorage.removeItem(ACCENT_KEY)
  } catch {
    // Storage refused: the colour still applies once the profiles have arrived.
  }
}

export const applyLook = (theme: Theme, accent: ProfileColor | null) => {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  if (accent) root.dataset.accent = accent
  else delete root.dataset.accent
  keepAccent(accent)

  // Each tag answers its own media query; a chosen theme sets both.
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    const own = meta.getAttribute('media')?.includes('light') ? 'light' : 'dark'
    meta.setAttribute('content', BAR_COLOURS[theme === 'system' ? own : theme])
  })
}

export const useTheme = () => {
  const { theme } = usePreferences()
  const profiles = useProfiles({ onError: () => {} })
  // Until the profiles arrive, the colour public/theme.js put back stays. Then the open profile's, or none on
  // « Qui lit ? ».
  const ready = profiles !== null
  const accent = profiles?.profiles.find(profile => profile.id === profiles.current)?.color ?? null

  useEffect(() => {
    const kept = (document.documentElement.dataset.accent as ProfileColor | undefined) ?? null
    applyLook(theme, ready ? accent : kept)
  }, [theme, accent, ready])
}

// The theme shown: a profile that never chose is on its device's.
export const shownTheme = (theme: Theme) =>
  theme !== 'system' ? theme : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
