// The days written under a curve: as many as fit in its width, evenly spread, the first and the last always.
export const evenTicks = (count: number, width: number, labelWidth: number): number[] => {
  if (count <= 0) return []
  const fit = Math.max(2, Math.floor(width / labelWidth))
  if (count <= fit) return Array.from({ length: count }, (_, index) => index)
  const shown = Math.min(fit, count)
  return Array.from({ length: shown }, (_, index) => Math.round((index * (count - 1)) / (shown - 1)))
}
