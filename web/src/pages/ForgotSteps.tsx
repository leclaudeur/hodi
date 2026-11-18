import { ArrowRight, Check, CircleCheck, KeyRound, Mail, RotateCw, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SIGN_IN_CODE_CHARACTERS, SIGN_IN_CODE_LENGTH } from '../api.ts'
import { EMAIL_PATTERN } from '../lib/email.ts'
import { passwordStrength } from '../lib/password-strength.ts'
import { useIsPhone } from '../lib/use-media.ts'
import Button from '../ui/Button.tsx'
import NewPasswordFields from '../ui/NewPasswordFields.tsx'
import Notice from '../ui/Notice.tsx'
import PinField from '../ui/PinField.tsx'
import RichText from '../ui/RichText.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import TextField from '../ui/TextField.tsx'
import householdStyles from '../views/household/Household.module.css'
import { Actions, StepHeader } from './SetupParts.tsx'
import styles from './SetupPage.module.css'

interface StepProps {
  error: string | null
  busy: boolean
  onBack: () => void
}

interface AskFormProps extends StepProps {
  email: string
  setEmail: (email: string) => void
  onAsk: () => void
  // Back the next day with the e-mail's code: straight to « Entre le code ».
  onHaveCode: () => void
}

// The account's e-mail, where the code goes.
export const AskForm = ({ email, setEmail, error, busy, onAsk, onHaveCode, onBack }: AskFormProps) => {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const valid = EMAIL_PATTERN.test(email.trim())
  return (
    <form
      className={styles.form}
      onSubmit={event => {
        event.preventDefault()
        if (valid) onAsk()
      }}
    >
      <StepHeader title={t('forgot.title')} intro={t('forgot.intro')} />
      <div className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('login.email')}</span>
        <TextField
          icon={Mail}
          type="email"
          autoComplete="username"
          autoFocus
          required
          aria-label={t('login.email')}
          value={email}
          onChange={event => setEmail(event.target.value)}
        />
        {error && <StatusLine tone="error">{error}</StatusLine>}
      </div>
      <Actions onBack={onBack} start={<Button onClick={onHaveCode}>{t('forgot.haveCode')}</Button>}>
        <Button type="submit" look="primary" icon={phone ? undefined : Send} busy={busy} disabled={!valid}>
          {t('forgot.send')}
        </Button>
      </Actions>
    </form>
  )
}

interface CodeFormProps extends StepProps {
  // Where the code went; null when the person came back with it.
  sentTo: string | null
  code: string
  setCode: (code: string) => void
  onCheck: () => void
  onResend: () => void
}

// « Entre le code »: the eight characters of the e-mail.
export const CodeForm = ({ sentTo, code, setCode, error, busy, onCheck, onResend, onBack }: CodeFormProps) => {
  const { t } = useTranslation()
  const full = code.length === SIGN_IN_CODE_LENGTH
  return (
    <form
      className={styles.form}
      onSubmit={event => {
        event.preventDefault()
        if (full) onCheck()
      }}
    >
      <StepHeader
        title={t('forgot.codeTitle')}
        intro={sentTo ? <RichText i18nKey="forgot.codeIntro" values={{ email: sentTo }} /> : t('forgot.codeIntroTyped')}
      />
      <PinField
        label={t('forgot.codeLabel')}
        labelHidden
        value={code}
        onChange={setCode}
        state={error ? 'wrong' : undefined}
        length={SIGN_IN_CODE_LENGTH}
        masked={false}
        characters={SIGN_IN_CODE_CHARACTERS}
        align="start"
        autoFocus
      />
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <Actions
        onBack={sentTo ? undefined : onBack}
        start={
          sentTo ? (
            <Button icon={RotateCw} onClick={onResend}>
              {t('forgot.resend')}
            </Button>
          ) : undefined
        }
      >
        <Button type="submit" look="primary" icon={Check} busy={busy} disabled={!full}>
          {t('forgot.confirm')}
        </Button>
      </Actions>
    </form>
  )
}

interface NewPasswordFormProps extends StepProps {
  account: string
  password: string
  confirm: string
  setPassword: (password: string) => void
  setConfirm: (confirm: string) => void
  onSave: () => void
}

// The account's new password.
export const NewPasswordForm = (props: NewPasswordFormProps) => {
  const { t } = useTranslation()
  const { account, password, confirm, error, busy } = props
  const ready = passwordStrength(password).score > 0 && password === confirm
  return (
    <form
      className={styles.form}
      onSubmit={event => {
        event.preventDefault()
        if (ready) props.onSave()
      }}
    >
      <StepHeader
        title={t('forgot.newTitle')}
        intro={<RichText i18nKey="forgot.newIntro" values={{ email: account }} />}
      />
      {/* For the browser's password manager: whose password this is. */}
      <input type="email" autoComplete="username" value={account} readOnly hidden />
      <NewPasswordFields
        password={password}
        confirm={confirm}
        onPassword={props.setPassword}
        onConfirm={props.setConfirm}
        autoFocus
      />
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <Actions start={<Button onClick={props.onBack}>{t('common.cancel')}</Button>}>
        <Button type="submit" look="primary" icon={KeyRound} busy={busy} disabled={!ready}>
          {t('forgot.save')}
        </Button>
      </Actions>
    </form>
  )
}

// The password changed, this device signed in with it.
export const DoneStep = ({ onEnter }: { onEnter: () => void }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.form}>
      <StepHeader title={t('forgot.doneTitle')} intro={t('forgot.doneIntro')} />
      <Notice tone="success" icon={CircleCheck} title={t('forgot.doneNotice')}>
        {t('forgot.doneText')}
      </Notice>
      <Actions>
        <Button look="primary" onClick={onEnter}>
          {t('forgot.enter')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </Actions>
    </div>
  )
}
