import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MIN_PASSWORD_LENGTH } from '../api.ts'
import householdStyles from '../views/household/Household.module.css'
import PasswordField from './PasswordField.tsx'
import { PasswordHint, PasswordRing } from './PasswordGauge.tsx'
import StatusLine from './StatusLine.tsx'

interface NewPasswordFieldsProps {
  password: string
  confirm: string
  onPassword: (value: string) => void
  onConfirm: (value: string) => void
  autoFocus?: boolean
}

// A new password with its strength gauge, then the same again: the setup, « J'ai un code » and a reset link.
const NewPasswordFields = ({ password, confirm, onPassword, onConfirm, autoFocus }: NewPasswordFieldsProps) => {
  const { t } = useTranslation()
  const mismatch = confirm !== '' && confirm !== password
  return (
    <>
      <div className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('setup.account.password')}</span>
        <PasswordField
          aria-label={t('setup.account.password')}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          autoFocus={autoFocus}
          lead={<PasswordRing password={password} />}
          value={password}
          onChange={event => onPassword(event.target.value)}
        />
        <PasswordHint password={password} />
      </div>
      <div className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('setup.account.confirm')}</span>
        <PasswordField
          icon={KeyRound}
          aria-label={t('setup.account.confirm')}
          autoComplete="new-password"
          required
          invalid={mismatch}
          value={confirm}
          onChange={event => onConfirm(event.target.value)}
        />
        {mismatch && <StatusLine tone="error">{t('setup.account.mismatch')}</StatusLine>}
      </div>
    </>
  )
}

export default NewPasswordFields
