import { useTranslation } from 'react-i18next'
import { MIN_PASSWORD_LENGTH } from '../api.ts'
import { usePasswordStrength } from '../lib/password-strength.ts'
import styles from './PasswordGauge.module.css'

const TONES = ['weak', 'weak', 'fair', 'strong', 'strong'] as const

// Four bars under a new password, how strong it is, and what would make it stronger. Too short, the first bar
// fills as it is typed, in red, so the gauge answers from the first key. Empty, it only states the minimum.
const PasswordGauge = ({ password }: { password: string }) => {
  const { t } = useTranslation()
  const { score, label, hint } = usePasswordStrength(password)
  const shortFill = score === 0 ? Math.min(1, password.length / MIN_PASSWORD_LENGTH) : 1
  return (
    <div
      className={`${styles.gauge} ${password ? styles[TONES[score]] : ''}`}
      role="meter"
      aria-label={t('password.gauge')}
      aria-valuemin={0}
      aria-valuemax={4}
      aria-valuenow={score}
      aria-valuetext={label}
    >
      <div className={styles.bars} aria-hidden="true">
        {[1, 2, 3, 4].map(bar => (
          <span key={bar} className={bar <= score ? styles.on : undefined}>
            {bar === 1 && score === 0 && <i className={styles.fill} style={{ width: `${shortFill * 100}%` }} />}
          </span>
        ))}
      </div>
      <div className={styles.text}>
        <span className={styles.hint}>{hint ?? t('password.perfect')}</span>
        {password && <span className={styles.label}>{label}</span>}
      </div>
    </div>
  )
}

export default PasswordGauge
