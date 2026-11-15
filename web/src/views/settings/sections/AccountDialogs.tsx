import { KeyRound, Mail } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AccountView, RequestError, changeAccountEmail, changeAccountPassword } from '../../../api.ts'
import { EMAIL_PATTERN } from '../../../lib/email.ts'
import { t } from '../../../lib/i18n.ts'
import { passwordStrength } from '../../../lib/password-strength.ts'
import { showSaved } from '../../../lib/toast.ts'
import { typesAtOnce } from '../../../lib/use-media.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import PasswordField from '../../../ui/PasswordField.tsx'
import { PasswordHint, PasswordRing } from '../../../ui/PasswordGauge.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import TextField from '../../../ui/TextField.tsx'
import householdStyles from '../../household/Household.module.css'
import { PluginSlots } from '../../../plugins/Slots.tsx'
import { usePluginSlots } from '../../../plugins/registry.ts'

const refusal = (failure: unknown, wrong: string, otherwise: string) => {
  if (failure instanceof RequestError && failure.code === 'invalid_password') return wrong
  if (failure instanceof RequestError && failure.code === 'too_many_attempts')
    return t('common.tooManyAttempts', { minutes: Math.ceil((failure.retryAfterSeconds ?? 900) / 60) })
  if (failure instanceof RequestError && failure.code === 'email_taken') return t('settings.account.emailTaken')
  if (failure instanceof RequestError && failure.code === 'sign_in_again') return t('settings.account.signInAgain')
  return otherwise
}

interface DialogProps {
  account: AccountView
  layout: 'desktop' | 'phone'
  onSaved: (next: AccountView) => void
  onClose: () => void
}

// An account with no password of its own (« Se connecter avec Google ») proves it is its person by a sign-in on this
// device in the last 5 minutes, through its plugin's button; the page then starts again and the change can be made.
const SignInFirst = ({
  title,
  layout,
  onClose
}: {
  title: string
  layout: 'desktop' | 'phone'
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const ways = usePluginSlots('signInExtras').length > 0
  return (
    <Dialog open onClose={onClose} title={title}>
      <div className={householdStyles.form}>
        <StatusLine tone="info">{t(ways ? 'settings.account.signInAgain' : 'settings.account.noWayIn')}</StatusLine>
        <PluginSlots slot="signInExtras" props={{ layout, signedIn: () => window.location.reload() }} />
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
        </DialogActions>
      </div>
    </Dialog>
  )
}

// "Changer d'e-mail": the new address and the password. Without a mail server, it changes at once.
export const EmailDialog = ({ account, layout, onSaved, onClose }: DialogProps) => {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrong = t('settings.account.wrongPassword')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      onSaved(await changeAccountEmail(email.trim(), password))
      showSaved(t('settings.account.emailSaved'))
      onClose()
    } catch (failure) {
      setError(refusal(failure, wrong, t('settings.account.emailFailed')))
      setSaving(false)
    }
  }

  if (account.loginOnly && !account.recentSignIn)
    return <SignInFirst title={t('settings.account.emailTitle')} layout={layout} onClose={onClose} />

  return (
    <Dialog open onClose={onClose} title={t('settings.account.emailTitle')} intro={t('settings.account.emailIntro')}>
      <form className={householdStyles.form} onSubmit={event => void submit(event)}>
        <label className={householdStyles.field}>
          <span className={householdStyles.fieldLabel}>{t('settings.account.newEmail')}</span>
          <TextField
            icon={Mail}
            type="email"
            autoComplete="username"
            aria-label={t('settings.account.newEmail')}
            placeholder={t('setup.account.emailPlaceholder')}
            autoFocus={typesAtOnce()}
            required
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
        </label>
        {!account.loginOnly ? (
          <div className={householdStyles.field}>
            <span className={householdStyles.fieldLabel}>{t('settings.account.yourPassword')}</span>
            <PasswordField
              aria-label={t('settings.account.yourPassword')}
              autoComplete="current-password"
              required
              invalid={error === wrong}
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </div>
        ) : null}
        {error && <StatusLine tone="error">{error}</StatusLine>}
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            type="submit"
            look="primary"
            busy={saving}
            disabled={!EMAIL_PATTERN.test(email.trim()) || (!account.loginOnly && !password)}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// The new password, its gauge and the same again.
const NewPasswordFields = ({
  next,
  onNext,
  confirm,
  onConfirm
}: {
  next: string
  onNext: (value: string) => void
  confirm: string
  onConfirm: (value: string) => void
}) => {
  const { t } = useTranslation()
  const mismatch = confirm !== '' && confirm !== next
  return (
    <>
      <div className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('settings.household.newPassword')}</span>
        <PasswordField
          icon={KeyRound}
          aria-label={t('settings.household.newPassword')}
          autoComplete="new-password"
          required
          lead={<PasswordRing password={next} />}
          value={next}
          onChange={event => onNext(event.target.value)}
        />
        <PasswordHint password={next} />
      </div>
      <div className={householdStyles.field}>
        <span className={householdStyles.fieldLabel}>{t('passwordChange.confirm')}</span>
        <PasswordField
          icon={KeyRound}
          aria-label={t('passwordChange.confirm')}
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

// The other devices sign in again with the new one; this one stays signed in.
// Without a password yet (« Se connecter avec Google »), « Choisir un mot de passe » asks for none.
export const PasswordDialog = ({ account, layout, onSaved, onClose }: DialogProps) => {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrong = t('settings.household.wrongPassword')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      onSaved(await changeAccountPassword(current, next))
      showSaved(t('settings.account.passwordSaved'))
      onClose()
    } catch (failure) {
      setError(refusal(failure, wrong, t('settings.household.passwordFailed')))
      setSaving(false)
    }
  }

  const title = t(account.loginOnly ? 'settings.account.choosePasswordTitle' : 'settings.household.passwordTitle')
  if (account.loginOnly && !account.recentSignIn) return <SignInFirst title={title} layout={layout} onClose={onClose} />

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      intro={t(account.loginOnly ? 'settings.account.choosePasswordIntro' : 'settings.account.passwordIntro')}
    >
      <form className={householdStyles.form} onSubmit={event => void submit(event)}>
        {!account.loginOnly ? (
          <div className={householdStyles.field}>
            <span className={householdStyles.fieldLabel}>{t('settings.household.currentPassword')}</span>
            <PasswordField
              aria-label={t('settings.household.currentPassword')}
              autoComplete="current-password"
              autoFocus={typesAtOnce()}
              required
              invalid={error === wrong}
              value={current}
              onChange={event => setCurrent(event.target.value)}
            />
          </div>
        ) : null}
        <NewPasswordFields next={next} onNext={setNext} confirm={confirm} onConfirm={setConfirm} />
        {error && <StatusLine tone="error">{error}</StatusLine>}
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            type="submit"
            look="primary"
            busy={saving}
            disabled={(!account.loginOnly && !current) || passwordStrength(next).score === 0 || confirm !== next}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
