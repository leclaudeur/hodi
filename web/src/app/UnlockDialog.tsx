import { LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Profile, type ProfileSecret, RequestError } from '../api.ts'
import { switchProfile } from '../lib/profiles.ts'
import Button from '../ui/Button.tsx'
import Checkbox from '../ui/Checkbox.tsx'
import Dialog from '../ui/Dialog.tsx'
import DialogActions from '../ui/DialogActions.tsx'
import PasswordField from '../ui/PasswordField.tsx'
import PinField from '../ui/PinField.tsx'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import QuietLink from '../ui/QuietLink.tsx'
import RichText from '../ui/RichText.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import styles from './ProfileSwitcher.module.css'

// Opening a profile from the menu, with what it asks; the refusal stays in the dialog.
const useUnlock = (profile: Profile) => {
  const { t } = useTranslation()
  const [wrong, setWrong] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const unlock = async (secret: ProfileSecret) => {
    if (opening) return false
    setOpening(true)
    try {
      if ((await switchProfile(profile.id, true, secret)) === 'pending') {
        setError(t('profiles.pending'))
        setOpening(false)
      }
      return true
    } catch (failure) {
      const code = failure instanceof RequestError ? failure.code : null
      if (code === 'wrong_password' || code === 'wrong_code') {
        setError(t(code === 'wrong_code' ? 'profiles.wrongCode' : 'profiles.wrongPassword'))
        setWrong(true)
      } else if (failure instanceof RequestError && code === 'too_many_attempts')
        setError(
          t('common.tooManyAttempts', { minutes: Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 60) / 60)) })
        )
      else setError(t('profiles.openFailed'))
      setOpening(false)
      return false
    }
  }
  const typing = () => {
    setWrong(false)
    setError(null)
  }
  return { wrong, error, opening, unlock, typing }
}

interface PasswordFormProps {
  profile: Profile
  own: number | null
  state: Unlocking
  // A private profile offers « Ne plus demander sur cet appareil »; a parent's forgotten code does not.
  trustable: boolean
}

// A private profile: its person's password, and « Ne plus demander sur cet appareil » on a device of theirs. A parent
// who forgot their code types their password the same way.
const PasswordForm = ({ profile, own, state, trustable }: PasswordFormProps) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [trust, setTrust] = useState(false)
  const theirs = profile.hasAccount && profile.id !== own
  const label = theirs ? t('profiles.passwordOf', { name: profile.name }) : t('profiles.yourPassword')
  return (
    <form
      id="profile-unlock"
      className={styles.pin}
      onSubmit={event => {
        event.preventDefault()
        if (password) void state.unlock({ password, trust }).then(opened => opened || setPassword(''))
      }}
    >
      <ProfileAvatar profile={profile} size={72} plain />
      <PasswordField
        className={styles.password}
        aria-label={label}
        placeholder={label}
        autoComplete="current-password"
        autoFocus
        required
        value={password}
        onChange={event => {
          setPassword(event.target.value)
          state.typing()
        }}
        invalid={state.wrong}
      />
      {trustable && (
        <Checkbox checked={trust} onChange={setTrust} underField>
          {t('profiles.trustDevice')}
        </Checkbox>
      )}
      {state.error && <StatusLine tone="error">{state.error}</StatusLine>}
    </form>
  )
}

// The parent's Code parental: the last digit opens the profile. Forgotten, their password opens it instead.
const CodeForm = ({ profile, state, onForgot }: { profile: Profile; state: Unlocking; onForgot: () => void }) => {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  return (
    <div className={styles.pin}>
      <ProfileAvatar profile={profile} size={72} plain />
      <PinField
        label={t('profiles.parentalCode')}
        length={6}
        autoFocus
        value={code}
        state={state.wrong ? 'wrong' : 'idle'}
        onChange={next => {
          setCode(next)
          state.typing()
        }}
        onComplete={full => void state.unlock({ code: full }).then(opened => opened || setCode(''))}
      />
      {state.error && <StatusLine tone="error">{state.error}</StatusLine>}
      <QuietLink
        icon={LockKeyhole}
        onClick={() => {
          state.typing()
          onForgot()
        }}
      >
        {t('profiles.forgotCode')}
      </QuietLink>
    </div>
  )
}

type Unlocking = ReturnType<typeof useUnlock>

// What an adult profile asks here before it opens: its own person's password, or its parent's Code parental.
const UnlockDialog = ({ profile, own, onClose }: { profile: Profile; own: number | null; onClose: () => void }) => {
  const { t } = useTranslation()
  const state = useUnlock(profile)
  const [forgot, setForgot] = useState(false)
  const code = profile.lock === 'code' && !forgot
  const theirs = profile.hasAccount && profile.id !== own
  let intro: 'dialogIntro.passwordOpen' | 'dialogIntro.ownOpen' | 'dialogIntro.codeOpen' = theirs
    ? 'dialogIntro.passwordOpen'
    : 'dialogIntro.ownOpen'
  if (code) intro = 'dialogIntro.codeOpen'
  return (
    <Dialog
      open
      onClose={onClose}
      title={profile.name}
      intro={<RichText i18nKey={intro} values={{ name: profile.name }} />}
    >
      {code ? (
        <CodeForm profile={profile} state={state} onForgot={() => setForgot(true)} />
      ) : (
        <PasswordForm profile={profile} own={own} state={state} trustable={profile.lock !== 'code'} />
      )}
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        {!code && (
          <Button type="submit" form="profile-unlock" look="primary" busy={state.opening}>
            {t('profiles.open')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

export default UnlockDialog
