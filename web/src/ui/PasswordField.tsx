import { Eye, EyeOff, Lock, type LucideIcon } from 'lucide-react'
import { type InputHTMLAttributes, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './PasswordField.module.css'

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  'aria-label': string
  icon?: LucideIcon
  // Red border: the password was refused.
  invalid?: boolean
  // In the icon's place: a new password's strength ring.
  lead?: ReactNode
}

// A password's pill: the lock, the dots, and the eye that shows it.
const PasswordField = ({ icon: Icon = Lock, invalid = false, lead, className = '', ...props }: PasswordFieldProps) => {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  return (
    <div className={`${styles.field} ${invalid ? styles.invalid : ''} ${className}`}>
      {lead ?? <Icon size={16} aria-hidden="true" />}
      <input
        className={styles.input}
        type={visible ? 'text' : 'password'}
        maxLength={256}
        aria-invalid={invalid}
        {...props}
      />
      <button
        type="button"
        className={styles.eye}
        onClick={() => setVisible(!visible)}
        aria-label={visible ? t('password.hide') : t('password.show')}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  )
}

export default PasswordField
