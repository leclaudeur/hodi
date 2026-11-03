import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'
import styles from './ColorSwatches.module.css'

interface ColorSwatchesProps<T extends string> {
  // Read out for the group.
  label: string
  value: T
  // color: any CSS colour, usually a token ("var(--topic-monde)").
  options: { value: T; name: string; color: string }[]
  onChange: (value: T) => void
  // Always one row across the width: the rounds spread out, and shrink on a narrow screen.
  row?: boolean
  // small: 24px rounds, for a setting beside its label (the accent colour).
  size?: 'default' | 'small'
}

// One colour among a few, as 32px rounds (24px small): a profile's colour, the accent colour.
const ColorSwatches = <T extends string>({
  label,
  value,
  options,
  onChange,
  row = false,
  size = 'default'
}: ColorSwatchesProps<T>) => (
  <div
    className={`${styles.swatches} ${row ? styles.row : ''} ${size === 'small' ? styles.small : ''}`}
    style={row ? ({ '--count': options.length } as CSSProperties) : undefined}
    role="group"
    aria-label={label}
  >
    {options.map(option => (
      <button
        key={option.value}
        type="button"
        className={styles.swatch}
        style={{ '--swatch': option.color } as CSSProperties}
        aria-label={option.name}
        title={option.name}
        aria-pressed={option.value === value}
        onClick={() => onChange(option.value)}
      >
        {option.value === value && <Check size={size === 'small' ? 12 : 14} aria-hidden="true" />}
      </button>
    ))}
  </div>
)

export default ColorSwatches
