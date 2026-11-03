import { updatePreferences, usePreferences } from './preferences.ts'

// Reader text size, one of the preferences shared by every device.
export const TEXT_SCALES = [0.85, 1, 1.15, 1.3, 1.5]

export const useTextSize = () => {
  const { textSize } = usePreferences()
  const index = Math.min(TEXT_SCALES.length - 1, Math.max(0, textSize))

  const change = (step: number) =>
    updatePreferences({ textSize: Math.min(TEXT_SCALES.length - 1, Math.max(0, index + step)) }, { quiet: true })

  return {
    scale: TEXT_SCALES[index] ?? 1,
    canShrink: index > 0,
    canGrow: index < TEXT_SCALES.length - 1,
    shrink: () => change(-1),
    grow: () => change(1)
  }
}
