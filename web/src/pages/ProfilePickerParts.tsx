import { ArrowRight, Lock, Plus, Settings } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_PROFILES, type Profile, RequestError, UnauthorizedError } from '../api.ts'
import { switchProfile, useProfiles } from '../lib/profiles.ts'
import { settingsHref } from '../lib/use-hash-route.ts'
import { PluginSlots, useScreenLayout } from '../plugins/Slots.tsx'
import { usePluginSlots } from '../plugins/registry.ts'
import Button from '../ui/Button.tsx'
import PasswordField from '../ui/PasswordField.tsx'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import styles from './ProfilePicker.module.css'

type Profiles = ReturnType<typeof useProfiles>

// Opening a profile: at once, or once its account's password is given.
export const useOpening = (chosen: boolean, onUnauthorized: () => void) => {
  const { t } = useTranslation()
  const [opening, setOpening] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The profile whose password is asked.
  const [unlocking, setUnlocking] = useState<Profile | null>(null)
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState(false)
  const value = useProfiles({
    fresh: true,
    onError: failure => {
      if (failure instanceof UnauthorizedError) onUnauthorized()
      else setError(t('profiles.loadFailed'))
    }
  })

  const refused = (failure: unknown) => {
    if (failure instanceof UnauthorizedError) onUnauthorized()
    else if (failure instanceof RequestError && failure.code === 'wrong_password') {
      setError(t('profiles.wrongPassword'))
      setWrong(true)
    } else if (failure instanceof RequestError && failure.code === 'too_many_attempts')
      setError(t('common.tooManyAttempts', { minutes: Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 60) / 60)) }))
    else setError(t('profiles.openFailed'))
  }

  const open = async (id: number, withPassword?: string) => {
    setOpening(id)
    setError(null)
    try {
      if ((await switchProfile(id, chosen, withPassword)) === 'pending') {
        setError(t('profiles.pending'))
        setOpening(null)
      }
    } catch (failure) {
      refused(failure)
      setPassword('')
      setOpening(null)
    }
  }

  const pick = (profile: Profile) => {
    // An adult without an account has no password yet: it opens once its person makes one with a code.
    if (profile.locked && !profile.hasAccount) {
      setError(t('profiles.noAccount', { name: profile.name }))
      return
    }
    // Already open here: no password to give again.
    if (profile.locked && !(chosen && profile.id === value?.current)) {
      setError(null)
      setPassword('')
      setWrong(false)
      setUnlocking(profile)
    } else void open(profile.id)
  }

  return {
    ...{ value, opening, error, setError, unlocking, setUnlocking, password, setPassword, wrong, setWrong },
    ...{ open, pick }
  }
}

export type Opening = ReturnType<typeof useOpening>

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
        <Button onClick={() => opening.setUnlocking(null)}>{t('common.back')}</Button>
      </div>
    </div>
  )
}

// The profile's account password, then "Ouvrir".
const PasswordForm = ({ opening, profile }: { opening: Opening; profile: Profile }) => {
  const { t } = useTranslation()
  const { password, error } = opening
  // Every adult asks for its account's password: "Mot de passe" alone on the profile signed in here.
  const label =
    profile.hasAccount && profile.id !== opening.value?.own
      ? t('profiles.passwordOf', { name: profile.name })
      : t('profiles.yourPassword')
  return (
    <form
      className={styles.pinBox}
      onSubmit={event => {
        event.preventDefault()
        if (password && opening.opening === null) void opening.open(profile.id, password)
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
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <div className={styles.unlockActions}>
        <Button
          onClick={() => {
            opening.setUnlocking(null)
            opening.setError(null)
          }}
        >
          {t('common.back')}
        </Button>
        <Button type="submit" look="primary" busy={opening.opening !== null} disabled={!password}>
          {t('profiles.open')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </form>
  )
}

// The profile being opened, by its password or through a plugin.
export const Unlock = ({ opening, profile }: { opening: Opening; profile: Profile }) => (
  <>
    <h1 className={styles.title}>{profile.name}</h1>
    {profile.loginOnly ? (
      <LoginOnly opening={opening} profile={profile} />
    ) : (
      <PasswordForm opening={opening} profile={profile} />
    )}
  </>
)

const Tile = ({ profile, opening, chosen }: { profile: Profile; opening: Opening; chosen: boolean }) => {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={styles.tile}
      onClick={() => opening.pick(profile)}
      disabled={opening.opening !== null}
      aria-current={chosen && profile.id === opening.value?.current ? 'true' : undefined}
    >
      <span className={`${styles.avatar} ${opening.opening === profile.id ? styles.opening : ''}`}>
        <ProfileAvatar profile={profile} size={96} plain />
        {profile.locked && (
          <span className={styles.lock}>
            <Lock size={13} aria-label={t('profiles.locked')} />
          </span>
        )}
      </span>
      <span className={styles.name}>{profile.name}</span>
    </button>
  )
}

interface WhoProps {
  opening: Opening
  chosen: boolean
  closed: boolean
  onAdd: () => void
}

// "Qui lit ?": the profiles, "Ajouter" for an adult, then « Gérer les profils » and the plugins' buttons.
export const Who = ({ opening, chosen, closed, onAdd }: WhoProps) => {
  const { t } = useTranslation()
  const layout = useScreenLayout()
  const value: Profiles = opening.value
  const profiles = value?.profiles ?? []
  // Any adult adds young profiles here; an adult joins with "Inviter un adulte", so that it has its account.
  const parent = profiles.find(profile => profile.id === value?.current)?.kind === 'adult'
  return (
    <>
      <h1 className={styles.title}>{t('profiles.who')}</h1>
      <ul className={styles.grid} aria-busy={!value}>
        {profiles.map(profile => (
          <li key={profile.id}>
            <Tile profile={profile} opening={opening} chosen={chosen} />
          </li>
        ))}
        {value && parent && profiles.length < MAX_PROFILES && (
          <li>
            <button type="button" className={styles.tile} onClick={onAdd}>
              <span className={styles.avatar}>
                <span className={styles.add}>
                  <Plus size={32} aria-hidden="true" />
                </span>
              </span>
              <span className={styles.name}>{t('profiles.add')}</span>
            </button>
          </li>
        )}
      </ul>

      {opening.error && (
        <StatusLine tone="error" className={styles.error}>
          {opening.error}
        </StatusLine>
      )}

      {/* « Gérer les profils », and a plugin's buttons beside it at the same height (« Changer de foyer »). */}
      <div className={styles.actions}>
        {chosen && !closed && (
          <Button icon={Settings} href={settingsHref('profiles')}>
            {t('profiles.manage')}
          </Button>
        )}
        <PluginSlots slot="whoIsReadingFooter" props={{ layout }} />
      </div>
    </>
  )
}
