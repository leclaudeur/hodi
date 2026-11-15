import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useIsPhone } from '../../lib/use-media.ts'
import Button from '../../ui/Button.tsx'
import RoundButton from '../../ui/RoundButton.tsx'
import styles from './Settings.module.css'

// The row's labelled button: on a phone, a round with the same icon (its label stays its name).
export interface RowAction {
  label: string
  // A fuller name for screen readers, when the label alone is ambiguous ("Déconnecter" → which device).
  ariaLabel?: string
  icon: LucideIcon
  look?: 'neutral' | 'danger' | 'primary' | 'ai'
  onClick?: () => void
  disabled?: boolean
  busy?: boolean
  // A link styled as the button.
  href?: string
  external?: boolean
}

interface SettingRowProps {
  label: ReactNode
  // What it is set to, under the label in the text colour. A row with a value has no description: its explanation
  // goes in the dialog that changes it.
  value?: ReactNode
  // What it does, under the label in grey: one line on a computer, two at most on a phone.
  hint?: ReactNode
  // A mark before the text: a followed subject's star, a profile's avatar.
  lead?: ReactNode
  // One labelled button, or two side by side ("Remplacer", "Supprimer").
  action?: RowAction | RowAction[]
  // A choice between a few options (Segmented): at the end, on its own line across the row on a phone.
  choice?: ReactNode
  // In a list (ul.card) or a card of rows (div.card).
  as?: 'div' | 'li'
  className?: string
  // Anything else at the end that stays there on a phone, before the actions: a switch, a status chip, small rounds.
  children?: ReactNode
}

export const RowButton = ({
  label,
  ariaLabel,
  icon,
  look = 'neutral',
  onClick,
  disabled,
  busy,
  href,
  external
}: RowAction) => {
  const phone = useIsPhone()
  return phone ? (
    <RoundButton
      icon={icon}
      label={ariaLabel ?? label}
      variant={look === 'neutral' ? 'default' : look}
      size={38}
      onClick={onClick}
      disabled={disabled}
      busy={busy}
      href={href}
      external={external}
    />
  ) : (
    <Button
      look={look}
      icon={icon}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      busy={busy}
      href={href}
      external={external}
    >
      {label}
    </Button>
  )
}

// One row of a settings card: its name, one line under it (its value, else what it does), then what changes it.
// Every action of a row is 38px tall.
const SettingRow = ({
  label,
  value,
  hint,
  lead,
  action,
  choice,
  as: Tag = 'div',
  className = '',
  children
}: SettingRowProps) => (
  <Tag className={`${styles.row} ${choice ? styles.choiceRow : ''} ${className}`}>
    {lead}
    <span className={styles.rowText}>
      <span className={styles.rowLabel}>{label}</span>
      {value !== undefined ? (
        <span className={styles.rowValue}>{value}</span>
      ) : (
        hint !== undefined && <span className={styles.rowHint}>{hint}</span>
      )}
    </span>
    {/* What the row shows at its end, such as a chip, before what changes it. */}
    {children}
    {action &&
      (Array.isArray(action) ? (
        <span className={styles.rowActions}>
          {action.map(one => (
            <RowButton key={one.label} {...one} />
          ))}
        </span>
      ) : (
        <RowButton {...action} />
      ))}
    {choice && <span className={styles.choice}>{choice}</span>}
  </Tag>
)

export default SettingRow
