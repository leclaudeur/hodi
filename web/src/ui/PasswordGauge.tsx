import { useTranslation } from 'react-i18next'
import { MIN_PASSWORD_LENGTH } from '../api.ts'
import { usePasswordStrength } from '../lib/password-strength.ts'
import styles from './PasswordGauge.module.css'

const TONES = ['weak', 'weak', 'fair', 'strong', 'strong'] as const
// As a lucide icon: 16px, drawn on 24 with a 2 stroke, as wide as the Mail and Key icons; its arc fills a quarter
// per level.
const RADIUS = 10
const LENGTH = 2 * Math.PI * RADIUS

// How strong a new password is, as a ring in its field's icon place. Too short, it fills as the password is
// typed up to its first quarter, in red, so it answers from the first key.
export const PasswordRing = ({ password }: { password: string }) => {
  const { t } = useTranslation()
  const { score, label } = usePasswordStrength(password)
  const filled = score === 0 ? Math.min(1, password.length / MIN_PASSWORD_LENGTH) / 4 : score / 4
  return (
    <span
      className={`${styles.ring} ${password ? styles[TONES[score]] : ''}`}
      role="meter"
      aria-label={t('password.gauge')}
      aria-valuemin={0}
      aria-valuemax={4}
      aria-valuenow={score}
      aria-valuetext={label}
      title={password ? label : undefined}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <circle className={styles.track} cx="12" cy="12" r={RADIUS} />
        <circle
          className={styles.arc}
          cx="12"
          cy="12"
          r={RADIUS}
          strokeDasharray={LENGTH}
          strokeDashoffset={LENGTH * (1 - filled)}
        />
      </svg>
    </span>
  )
}

// What would make it stronger, in one line under the field, only while it is not strong yet: as an error under a
// field, it goes once there is nothing left to fix.
export const PasswordHint = ({ password }: { password: string }) => {
  const { score, label, hint } = usePasswordStrength(password)
  if (!password || score >= 3) return null
  return (
    <p className={`${styles.hint} ${styles[TONES[score]]}`}>
      <span className={styles.level}>{label}</span>
      {hint && ` · ${hint}`}
    </p>
  )
}
