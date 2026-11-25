// Applies the reader's theme and its profile's colour before the first paint, from this device's copies (see
// src/lib/user-state.ts and src/lib/theme.ts), so a light theme never flashes dark nor the colour rust.
try {
  var preferences = JSON.parse(localStorage.getItem('hodi:user-state') || 'null').preferences
  // poudre: Poudré's name before every id was English.
  var theme = preferences.theme === 'poudre' ? 'powder' : preferences.theme
  if (['light', 'dark', 'powder'].indexOf(theme) !== -1) {
    document.documentElement.dataset.theme = theme
  }
} catch {
  // No settings yet: the system's choice applies.
}
try {
  var accent = localStorage.getItem('hodi:accent')
  if (accent) document.documentElement.dataset.accent = accent
} catch {
  // Nothing kept: the theme's own colour applies.
}
