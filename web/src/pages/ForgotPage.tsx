import type { TFunction } from 'i18next'
import { ArrowRight, Mail, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RequestError, askResetLink, checkResetLink, resetWithLink } from '../api.ts'
import { EMAIL_PATTERN } from '../lib/email.ts'
import { passwordStrength } from '../lib/password-strength.ts'
import Button from '../ui/Button.tsx'
import NewPasswordFields from '../ui/NewPasswordFields.tsx'
import RichText from '../ui/RichText.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import TextField from '../ui/TextField.tsx'
import householdStyles from '../views/household/Household.module.css'
import { Actions, SetupFrame, StepHeader } from './SetupParts.tsx'
import styles from './SetupPage.module.css'
import { refusalText } from '../lib/sign-in-refusal.ts'

// The link of the e-mail: the Connexion page opens on « Nouveau mot de passe ».
export const RESET_LINK = /^#\/reset\/([A-Za-z0-9_-]{43})$/

interface ForgotPageProps {
  // From the e-mail's link: the link's token, checked at once.
  token?: string
  // Back to the Connexion page.
  onBack: () => void
  // The new password is set and this device signed in with it.
  // signedIn false: the account asks for its app's code, so the device signs in on Connexion.
  onDone: (signedIn: boolean) => void
}

const refusalOf = (failure: unknown, t: TFunction) => {
  if (!(failure instanceof RequestError)) return t('common.unreachable')
  if (failure.refusal) return refusalText(failure.refusal)
  if (failure.code === 'too_many_attempts' && failure.retryAfterSeconds)
    return t('common.tooManyAttempts', { minutes: Math.ceil(failure.retryAfterSeconds / 60) })
  return t('forgot.failed')
}

interface AskFormProps {
  email: string
  setEmail: (email: string) => void
  error: string | null
  busy: boolean
  onAsk: () => void
  onBack: () => void
}

// The e-mail to send the link to.
const AskForm = ({ email, setEmail, error, busy, onAsk, onBack }: AskFormProps) => {
  const { t } = useTranslation()
  return (
    <form
      className={styles.form}
      onSubmit={event => {
        event.preventDefault()
        if (EMAIL_PATTERN.test(email.trim())) onAsk()
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
      <Actions onBack={onBack}>
        <Button type="submit" look="primary" icon={Send} busy={busy} disabled={!EMAIL_PATTERN.test(email.trim())}>
          {t('forgot.send')}
        </Button>
      </Actions>
    </form>
  )
}

interface NewPasswordFormProps {
  account: string
  password: string
  confirm: string
  setPassword: (password: string) => void
  setConfirm: (confirm: string) => void
  error: string | null
  busy: boolean
  onSave: () => void
  onBack: () => void
}

// From the link: the account's new password.
const NewPasswordForm = (props: NewPasswordFormProps) => {
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
      <Actions onBack={props.onBack}>
        <Button type="submit" look="primary" busy={busy} disabled={!ready}>
          {t('forgot.save')}
          {!busy && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
      </Actions>
    </form>
  )
}

// The link's account: undefined while it is checked, null when it no longer works.
const useResetLink = (token: string | undefined) => {
  const [account, setAccount] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!token) return
    checkResetLink(token)
      .then(({ email: owner }) => setAccount(owner))
      .catch(() => setAccount(null))
  }, [token])
  return [account, setAccount] as const
}

const SentStep = ({ sentTo, onBack }: { sentTo: string; onBack: () => void }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.form}>
      <StepHeader
        title={t('forgot.sentTitle')}
        intro={<RichText i18nKey="forgot.sentIntro" values={{ email: sentTo }} />}
      />
      <Actions onBack={onBack}>{null}</Actions>
    </div>
  )
}

// A link that no longer works: another one is asked.
const DeadLink = ({ onAskAgain, onBack }: { onAskAgain: () => void; onBack: () => void }) => {
  const { t } = useTranslation()
  return (
    <div className={styles.form}>
      <StepHeader title={t('forgot.deadTitle')} intro={t('forgot.deadIntro')} />
      <Actions onBack={onBack}>
        <Button look="primary" onClick={onAskAgain}>
          {t('forgot.askAgain')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </Actions>
    </div>
  )
}

// « Mot de passe oublié »: the e-mail to send the link to, then, from the link, the new password.
const ForgotPage = ({ token, onBack, onDone }: ForgotPageProps) => {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [account, setAccount] = useResetLink(token)
  const [asking, setAsking] = useState(token === undefined)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refusal = (failure: unknown) => refusalOf(failure, t)

  const ask = async () => {
    setBusy(true)
    setError(null)
    try {
      await askResetLink(email.trim())
      setSentTo(email.trim())
    } catch (failure) {
      setError(refusal(failure))
    }
    setBusy(false)
  }

  const save = async () => {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      const answer = await resetWithLink(token, password)
      onDone(answer?.signIn !== false)
    } catch (failure) {
      if (failure instanceof RequestError && failure.code === 'invalid_link') setAccount(null)
      else setError(refusal(failure))
      setBusy(false)
    }
  }

  const askAgain = () => {
    setAsking(true)
    setError(null)
  }

  let content
  if (asking && sentTo) {
    content = <SentStep sentTo={sentTo} onBack={onBack} />
  } else if (asking) {
    content = (
      <AskForm email={email} setEmail={setEmail} error={error} busy={busy} onAsk={() => void ask()} onBack={onBack} />
    )
  } else if (account === undefined) {
    content = (
      <div className={styles.form}>
        <StepHeader title={t('forgot.newTitle')} intro={t('forgot.checking')} />
      </div>
    )
  } else if (account === null) {
    content = <DeadLink onAskAgain={askAgain} onBack={onBack} />
  } else {
    content = (
      <NewPasswordForm
        account={account}
        password={password}
        confirm={confirm}
        setPassword={setPassword}
        setConfirm={setConfirm}
        error={error}
        busy={busy}
        onSave={() => void save()}
        onBack={onBack}
      />
    )
  }

  return <SetupFrame>{content}</SetupFrame>
}

export default ForgotPage
