import { Lock, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Profile, type ProfileSecret, RequestError, UnauthorizedError } from '../api.ts'
import { switchProfile, useProfiles } from '../lib/profiles.ts'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import styles from './ProfilePicker.module.css'

type Profiles = ReturnType<typeof useProfiles>

// Opening a profile: at once, or once its account's password or the household's Code parental is given.
export const useOpening = (chosen: boolean, onUnauthorized: () => void) => {
  const { t } = useTranslation()
  const [opening, setOpening] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The profile whose password is asked.
  const [unlocking, setUnlocking] = useState<Profile | null>(null)
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState(false)
  // « Ne plus demander sur cet appareil », under a private profile's password.
  const [trust, setTrust] = useState(false)
  const value = useProfiles({
    fresh: true,
    onError: failure => {
      if (failure instanceof UnauthorizedError) onUnauthorized()
      else setError(t('profiles.loadFailed'))
    }
  })

  const refused = (failure: unknown) => {
    if (failure instanceof UnauthorizedError) onUnauthorized()
    else if (failure instanceof RequestError && ['wrong_password', 'wrong_code'].includes(failure.code ?? '')) {
      setError(t(failure.code === 'wrong_code' ? 'profiles.wrongCode' : 'profiles.wrongPassword'))
      setWrong(true)
    } else if (failure instanceof RequestError && failure.code === 'too_many_attempts')
      setError(t('common.tooManyAttempts', { minutes: Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 60) / 60)) }))
    else setError(t('profiles.openFailed'))
  }

  const open = async (id: number, secret?: ProfileSecret) => {
    setOpening(id)
    setError(null)
    try {
      if ((await switchProfile(id, chosen, secret)) === 'pending') {
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
      setTrust(false)
      setUnlocking(profile)
    } else void open(profile.id)
  }

  return {
    ...{
      value,
      opening,
      error,
      setError,
      unlocking,
      setUnlocking,
      password,
      setPassword,
      wrong,
      setWrong,
      trust,
      setTrust
    },
    ...{ open, pick }
  }
}

export type Opening = ReturnType<typeof useOpening>

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
  onAdd: () => void
}

// "Qui lit ?": the profiles shown on this device, then « Ajouter » for one more account.
export const Who = ({ opening, chosen, onAdd }: WhoProps) => {
  const { t } = useTranslation()
  const value: Profiles = opening.value
  // The accounts signed in here first, then the young profiles.
  const profiles = (value?.profiles ?? [])
    .filter(profile => profile.here !== false)
    .sort((a, b) => Number(a.kind !== 'adult') - Number(b.kind !== 'adult'))
  return (
    <>
      <h1 className={styles.title}>{t('profiles.who')}</h1>
      <ul className={styles.grid} aria-busy={!value}>
        {profiles.map(profile => (
          <li key={profile.id}>
            <Tile profile={profile} opening={opening} chosen={chosen} />
          </li>
        ))}
        {value && (
          <li>
            <button type="button" className={styles.tile} onClick={onAdd}>
              <span className={styles.avatar}>
                <span className={styles.add}>
                  <UserPlus size={30} aria-hidden="true" />
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
    </>
  )
}
