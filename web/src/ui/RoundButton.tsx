import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './RoundButton.module.css'

export type RoundVariant = 'default' | 'on' | 'glass' | 'image' | 'ai' | 'danger' | 'primary'

interface RoundButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  label: string
  variant?: RoundVariant
  // Three sizes only. 28: where room is short (a card's or a list row's actions). 34: where there is room (a
  // reader's header, a computer's bars). 44: to the finger, or beside a 44px capsule (Résumé du jour).
  size?: 28 | 34 | 44
  // Filled icon (a saved bookmark).
  filled?: boolean
  // Waiting on the server: the icon turns (pair it with a loader icon).
  busy?: boolean
  href?: string
  // The link opens the site in a new tab.
  external?: boolean
  children?: ReactNode
}

// The small rounds of a card's meta row (bookmark, "Masquer", "Marquer comme non lu"): they keep the row's height.
export const CARD_BUTTON = styles.card ?? ''

const RoundButton = ({
  icon: Icon,
  label,
  variant = 'default',
  size = 34,
  filled = false,
  busy = false,
  href,
  external = false,
  className = '',
  ...props
}: RoundButtonProps) => {
  const classes = [styles.button, styles[variant], styles[`size${size}`], className].join(' ')
  const icon = (
    <Icon
      size={size === 28 ? 14 : size === 34 ? 16 : 18}
      fill={filled ? 'currentColor' : 'none'}
      className={busy ? styles.busy : undefined}
      aria-hidden="true"
    />
  )

  return href ? (
    <a
      className={classes}
      href={href}
      aria-label={label}
      title={label}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {icon}
    </a>
  ) : (
    <button type="button" className={classes} aria-label={label} title={label} aria-busy={busy || undefined} {...props}>
      {icon}
    </button>
  )
}

export default RoundButton
