// Serveur › Vue d'ensemble's figures: up to 999 in full, then in thousands with one decimal (« 1,7 » and a small
// « K », as the hours' « h »).
export const shortFigure = (value: number, language: string, digits = 0) =>
  value >= 1000
    ? { text: (value / 1000).toLocaleString(language, { maximumFractionDigits: 1 }), thousands: true }
    : { text: value.toLocaleString(language, { maximumFractionDigits: digits }), thousands: false }

// The change against the period before, in whole percents; null when there was nothing to compare with.
export const changeOf = (value: number, before: number | null) =>
  before ? Math.round(((value - before) / before) * 100) : null
