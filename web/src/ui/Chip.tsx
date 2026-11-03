import type { ReactNode } from 'react'
import styles from './Chip.module.css'

// A small neutral capsule: "EN", "SUR LE SITE", a duration. success: "DISPO HORS LIGNE"; warning: "PEU OUVERTE";
// accent: "CET APPAREIL". title: what it means, on hover.
// capsule: beside a topic capsule, at its size. row: at the end of a settings row, the round buttons' 28px.
const Chip = ({
  children,
  label,
  title,
  tone,
  size
}: {
  children: ReactNode
  label?: string
  title?: string
  tone?: 'success' | 'warning' | 'accent'
  size?: 'capsule' | 'row'
}) => (
  <span
    className={`${styles.chip} ${tone ? styles[tone] : ''} ${size ? styles[size] : ''}`}
    aria-label={label}
    title={title}
  >
    {children}
  </span>
)

export default Chip
