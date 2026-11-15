import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'
import styles from './Button.module.css'

// neutral: most actions. primary: the one action a screen leads to. danger: what deletes or resets.
// ai: a click that spends credits (violet). glass: floating over a list, blurred ("Charger <jour>").
export type ButtonLook = 'neutral' | 'primary' | 'danger' | 'ai' | 'glass'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  look?: ButtonLook
  // Before the label, 16px: a Lucide icon, or the AI sparkle.
  icon?: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>
  // Waiting on the server: the icon becomes a turning loader and the button can't be pressed again.
  busy?: boolean
  // Across its container.
  wide?: boolean
  // 34px: a row's or a header's smaller button, as tall as the 34px rounds.
  compact?: boolean
  // A link styled as a button.
  href?: string
  // The link opens the site in a new tab.
  external?: boolean
}

// Every button with a label in the app: one height (44px, 32 when compact), one type, the same states (hover, pressed,
// keyboard focus, disabled, busy). Icon-only buttons are RoundButton.
const Button = ({
  children,
  look = 'neutral',
  icon: Icon,
  busy = false,
  wide = false,
  compact = false,
  href,
  external = false,
  className = '',
  disabled,
  ...props
}: ButtonProps) => {
  const classes = [
    styles.button,
    styles[look],
    Icon || busy ? styles.withIcon : '',
    wide ? styles.wide : '',
    compact ? styles.compact : '',
    className
  ].join(' ')
  const content = (
    <>
      {busy ? (
        <LoaderCircle size={compact ? 14 : 16} className={styles.busy} aria-hidden="true" />
      ) : (
        Icon && <Icon size={compact ? 14 : 16} aria-hidden="true" />
      )}
      {children}
    </>
  )

  return href ? (
    <a
      className={classes}
      href={href}
      aria-label={props['aria-label']}
      aria-current={props['aria-current']}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {content}
    </a>
  ) : (
    <button type="button" className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      {content}
    </button>
  )
}

export default Button
