// Applies the reader's theme and accent before the first paint, from this device's copy of the settings
// (see src/lib/user-state.ts and src/lib/theme.ts), so a light theme never flashes dark.
try {
  var preferences = JSON.parse(localStorage.getItem('hodi:user-state') || 'null').preferences
  // poudre: Poudré's name before every id was English.
  var theme = preferences.theme === 'poudre' ? 'powder' : preferences.theme
  if (['light', 'dark', 'powder'].indexOf(theme) !== -1) {
    document.documentElement.dataset.theme = theme
  }
  if (typeof preferences.accent === 'string' && preferences.accent !== 'auto') {
    document.documentElement.dataset.accent = preferences.accent
  }
} catch {
  // No settings yet: the system's choice applies.
}
