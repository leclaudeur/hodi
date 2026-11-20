import { ArrowRight, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Profile } from '../api.ts'
import { PluginSlots, useScreenLayout } from '../plugins/Slots.tsx'
import { usePluginSlots } from '../plugins/registry.ts'
import Button from '../ui/Button.tsx'
import Checkbox from '../ui/Checkbox.tsx'
import PasswordField from '../ui/PasswordField.tsx'
import PinField from '../ui/PinField.tsx'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import QuietLink from '../ui/QuietLink.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import type { Opening } from './ProfilePickerParts.tsx'
import styles from './ProfilePicker.module.css'

const BackButton = ({ opening }: { opening: Opening }) => {
  const { t } = useTranslation()
  return (
    <Button
      onClick={() => {
        opening.setUnlocking(null)
        opening.setError(null)
      }}
    >
      {t('common.back')}
    </Button>
  )
}

// A profile with no password to type: its person signs in again through a plugin, which opens their profile.
const LoginOnly = ({ opening, profile }: { opening: Opening; profile: Profile }) => {
  const { t } = useTranslation()
  const layout = useScreenLayout()
  // The plugins' ways in (« Continuer avec Google »), for a profile whose account has no password of its own.
  const ways = usePluginSlots('signInExtras').length > 0
  return (
    <div className={styles.pinBox}>
      <ProfileAvatar profile={profile} size={72} plain />
      <StatusLine tone="info">
        {t(ways ? 'profiles.loginOnly' : 'profiles.loginOnlyNoWay', { name: profile.name })}
      </StatusLine>
      <div className={styles.ways}>
        <PluginSlots slot="signInExtras" props={{ layout, signedIn: () => window.location.reload() }} />
      </div>
      <div className={`${styles.unlockActions} ${styles.single}`}>
        <BackButton opening={opening} />
      </div>
    </div>
  )
}

// A private profile: its account's password, « Ne plus demander sur cet appareil », then "Ouvrir". A parent who
// forgot their code types their password the same way, with nothing to trust: their code stays asked here.
const PasswordForm = ({ opening, profile }: { opening: Opening; profile: Profile }) => {
  const trustable = profile.lock !== 'code'
  const { t } = useTranslation()
  const { password, error } = opening
  const label =
    profile.hasAccount && profile.id !== opening.value?.own
      ? t('profiles.passwordOf', { name: profile.name })
      : t('profiles.yourPassword')
  return (
    <form
      className={styles.pinBox}
      onSubmit={event => {
        event.preventDefault()
        if (password && opening.opening === null)
          void opening.open(profile.id, { password, trust: trustable && opening.trust })
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
          opening.setPassword(event.target.value)
          opening.setWrong(false)
          opening.setError(null)
        }}
        invalid={opening.wrong}
      />
      {/* On a shared device its person leaves it unticked: the next reader meets the password again. */}
      {trustable && (
        <Checkbox checked={opening.trust} onChange={opening.setTrust} underField>
          {t('profiles.trustDevice')}
        </Checkbox>
      )}
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <div className={styles.unlockActions}>
        <BackButton opening={opening} />
        <Button type="submit" look="primary" busy={opening.opening !== null} disabled={!password}>
          {t('profiles.open')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </form>
  )
}

// A parent's profile that is not private, on a device where a young account is signed in: their own code's six digits
// open it at once. Forgotten, their password opens it instead.
const CodeForm = ({ opening, profile, onForgot }: { opening: Opening; profile: Profile; onForgot: () => void }) => {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  return (
    <div className={styles.pinBox}>
      <ProfileAvatar profile={profile} size={72} plain />
      <PinField
        label={t('profiles.parentalCode')}
        length={6}
        autoFocus
        value={code}
        state={opening.wrong ? 'wrong' : 'idle'}
        onChange={next => {
          setCode(next)
          opening.setWrong(false)
          opening.setError(null)
        }}
        onComplete={full => void opening.open(profile.id, { code: full }).then(() => setCode(''))}
      />
      {opening.error && <StatusLine tone="error">{opening.error}</StatusLine>}
      <QuietLink
        icon={LockKeyhole}
        onClick={() => {
          opening.setError(null)
          onForgot()
        }}
      >
        {t('profiles.forgotCode')}
      </QuietLink>
      <div className={`${styles.unlockActions} ${styles.single}`}>
        <BackButton opening={opening} />
      </div>
    </div>
  )
}

// The profile being opened: by its password, the parent's code, or through a plugin.
export const Unlock = ({ opening, profile }: { opening: Opening; profile: Profile }) => {
  const [forgot, setForgot] = useState(false)
  let form = <PasswordForm opening={opening} profile={profile} />
  if (profile.loginOnly) form = <LoginOnly opening={opening} profile={profile} />
  else if (profile.lock === 'code' && !forgot)
    form = <CodeForm opening={opening} profile={profile} onForgot={() => setForgot(true)} />
  return (
    <>
      <h1 className={styles.title}>{profile.name}</h1>
      {form}
    </>
  )
}
