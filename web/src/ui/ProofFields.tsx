import { useTranslation } from 'react-i18next'
import { RequestError } from '../api.ts'
import styles from './ConfirmDialog.module.css'
import PasswordField from './PasswordField.tsx'
import PinField from './PinField.tsx'

export type ProofError = 'wrongPassword' | 'wrongCode' | 'failed'

// The server's refusal, as the line shown under the fields.
const ERRORS = new Map<string | null, ProofError>([
  ['invalid_password', 'wrongPassword'],
  ['invalid_code', 'wrongCode']
])

export const proofErrorOf = (failure: unknown): ProofError =>
  ERRORS.get(failure instanceof RequestError ? failure.code : null) ?? 'failed'

interface ProofFieldsProps {
  askPassword: boolean
  askCode: boolean
  error: ProofError | null
  password: string
  code: string
  onPassword: (password: string) => void
  onCode: (code: string) => void
  // Off when another field of the dialog takes the focus first.
  autoFocus?: boolean
}

// The password and the authenticator code an action asks for, as the account requires.
const ProofFields = ({
  askPassword,
  askCode,
  error,
  password,
  code,
  onPassword,
  onCode,
  autoFocus = true
}: ProofFieldsProps) => {
  const { t } = useTranslation()
  return (
    <div className={styles.fields}>
      {askPassword && (
        <label className={styles.field}>
          <span className={styles.label}>{t('confirm.proof.password')}</span>
          <PasswordField
            aria-label={t('confirm.proof.password')}
            autoComplete="current-password"
            autoFocus={autoFocus}
            required
            invalid={error === 'wrongPassword'}
            value={password}
            onChange={event => onPassword(event.target.value)}
          />
        </label>
      )}
      {askCode && (
        <PinField
          label={t('confirm.proof.code')}
          length={6}
          masked={false}
          align="start"
          autoFocus={autoFocus && !askPassword}
          state={error === 'wrongCode' ? 'wrong' : 'idle'}
          value={code}
          onChange={onCode}
        />
      )}
    </div>
  )
}

export default ProofFields
