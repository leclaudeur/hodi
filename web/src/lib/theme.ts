import { useEffect } from 'react'
import { type Accent, type Theme, usePreferences } from './preferences.ts'

// "Apparence": Clair, Sombre or Poudré, and the accent colour. The choices set data-theme and data-accent on
// <html> (see styles/tokens.css); public/theme.js applies them before the first paint.

// The browser's bar matches the top of the page.
const BAR_COLOURS = { dark: '#131314', light: '#F3EEE4', poudre: '#191215' }

const apply = (theme: Theme, accent: Accent) => {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  if (accent === 'auto') delete root.dataset.accent
  else root.dataset.accent = accent

  // Each tag answers its own media query; a chosen theme sets both.
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    const own = meta.getAttribute('media')?.includes('light') ? 'light' : 'dark'
    meta.setAttribute('content', BAR_COLOURS[theme === 'system' ? own : theme])
  })
}

export const useTheme = () => {
  const { theme, accent } = usePreferences()

  useEffect(() => {
    apply(theme, accent)
  }, [theme, accent])
}

// The theme shown: a profile that never chose is on its device's.
export const shownTheme = (theme: Theme) =>
  theme !== 'system' ? theme : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
