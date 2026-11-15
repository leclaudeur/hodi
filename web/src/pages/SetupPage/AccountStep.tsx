import { ArrowRight, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Button from '../../ui/Button.tsx'
import NewPasswordFields from '../../ui/NewPasswordFields.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import TextField from '../../ui/TextField.tsx'
import householdStyles from '../../views/household/Household.module.css'
import { Actions, StepHeader } from '../SetupParts.tsx'
import styles from '../SetupPage.module.css'

interface AccountStepProps {
  total: number
  email: string
  password: string
  confirm: string
  onEmail: (value: string) => void
  onPassword: (value: string) => void
  onConfirm: (value: string) => void
  ready: boolean
  busy: boolean
  error: string | null
  onCreate: () => void
  onBack: () => void
}

// « Compte »: the server admin's e-mail and password.
const AccountStep = (props: AccountStepProps) => {
  const { t } = useTranslation()
  return (
    <form
      className={styles.form}
      onSubmit={event => {
        event.preventDefault()
        if (props.ready) props.onCreate()
      }}
    >
      <StepHeader
        step={1}
        total={props.total}
        title={t('setup.account.title')}
        intro={t('setup.account.intro')}
        help={{ id: 'setup-account', title: t('setup.account.helpTitle'), body: <p>{t('setup.account.help')}</p> }}
      />
      <label className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('setup.account.email')}</span>
        <TextField
          icon={Mail}
          type="email"
          autoComplete="username"
          aria-label={t('setup.account.email')}
          placeholder={t('setup.account.emailPlaceholder')}
          autoFocus
          required
          value={props.email}
          onChange={event => props.onEmail(event.target.value)}
        />
      </label>
      <NewPasswordFields
        password={props.password}
        confirm={props.confirm}
        onPassword={props.onPassword}
        onConfirm={props.onConfirm}
      />
      {props.error && <StatusLine tone="error">{props.error}</StatusLine>}
      <Actions onBack={props.onBack}>
        <Button type="submit" look="primary" busy={props.busy} disabled={!props.ready}>
          {t('common.continue')}
          {!props.busy && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
      </Actions>
    </form>
  )
}

export default AccountStep
