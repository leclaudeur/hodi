// A number typed in a field: its digits only, kept between min and max; null while nothing is typed.
export const typedNumber = (text: string, min: number, max: number): number | null => {
  const digits = text.replace(/\D/g, '')
  if (!digits) return null
  return Math.min(max, Math.max(min, Number(digits)))
}

// The digits a field keeps while typing: no more than the largest value has.
export const typedDigits = (text: string, max: number) => text.replace(/\D/g, '').slice(0, String(max).length)
