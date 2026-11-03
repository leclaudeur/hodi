import { ArrowLeft, Lock, Plus, Settings } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_PROFILES, PIN_PATTERN, PROFILE_COLORS, type Profile, RequestError, UnauthorizedError } from '../api.ts'
import { addProfile, switchProfile, useProfiles } from '../lib/profiles.ts'
import { settingsHref } from '../lib/use-hash-route.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import PhoneHeader from '../ui/PhoneHeader.tsx'
import PinField, { type PinState } from '../ui/PinField.tsx'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import ProfileForm from '../views/profiles/ProfileForm.tsx'
import styles from './ProfilePicker.module.css'

interface ProfilePickerProps {
  // False: the first visit since profiles exist, or the profile was deleted. Nothing to go back to.
  chosen: boolean
  // The current profile's time is up ("À demain"): no way back to the feed or its settings, only another profile.
  closed?: boolean
  onUnauthorized: () => void
}

// "Qui lit ?": the household's profiles, Netflix style. Picking one opens Hodi as that reader.
const ProfilePicker = ({ chosen, closed = false, onUnauthorized }: ProfilePickerProps) => {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [opening, setOpening] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The profile whose PIN is asked.
  const [unlocking, setUnlocking] = useState<Profile | null>(null)
  const [pin, setPin] = useState('')
  const [pinState, setPinState] = useState<PinState>('idle')
  const value = useProfiles({
    fresh: true,
    onError: failure => {
      if (failure instanceof UnauthorizedError) onUnauthorized()
      else setError(t('profiles.loadFailed'))
    }
  })

  const open = async (id: number, withPin?: string) => {
    setOpening(id)
    setError(null)
    try {
      // Green boxes a moment, then the profile opens.
      const opened = withPin
        ? async () => {
            setPinState('right')
            await new Promise(resolve => setTimeout(resolve, 450))
          }
        : undefined
      if ((await switchProfile(id, chosen, withPin, opened)) === 'pending') {
        setError(t('profiles.pending'))
        setOpening(null)
      }
    } catch (failure) {
      if (failure instanceof UnauthorizedError) onUnauthorized()
      else if (failure instanceof RequestError && failure.code === 'wrong_pin') {
        setError(t('profiles.wrongPin'))
        setPinState('wrong')
      } else if (failure instanceof RequestError && failure.code === 'too_many_attempts')
        setError(
          t('common.tooManyAttempts', { minutes: Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 60) / 60)) })
        )
      else setError(t('profiles.openFailed'))
      setPin('')
      setOpening(null)
    }
  }

  const pick = (profile: Profile) => {
    // Already open here: no PIN to give again.
    if ((profile.locked || profile.parental) && !(chosen && profile.id === value?.current)) {
      setError(null)
      setPin('')
      setPinState('idle')
      setUnlocking(profile)
    } else void open(profile.id)
  }

  const unlock = (code: string) => {
    if (unlocking && PIN_PATTERN.test(code) && opening === null) void open(unlocking.id, code)
  }

  const profiles = value?.profiles ?? []
  const freeColor = PROFILE_COLORS.find(color => !profiles.some(profile => profile.color === color))
  // Profiles are added by the admin, young ones by any adult.
  const own = profiles.find(profile => profile.id === value?.current)
  const admin = own?.role === 'admin'
  const parent = own?.kind === 'adult'

  return (
    <main className={styles.page}>
      <PhoneHeader
        back={
          chosen &&
          !closed &&
          !adding && (
            // On a computer it matches the sidebar's avatar and search buttons; 44 is for touch.
            <RoundButton icon={ArrowLeft} label={t('nav.backToFeed')} size={44} href="#/" />
          )
        }
        logo={chosen && !closed ? '#/' : true}
        className={styles.header}
      />
      <div className={styles.content}>
        {unlocking ? (
          <>
            <h1 className={styles.title}>{unlocking.name}</h1>
            <form
              className={styles.pinBox}
              onSubmit={event => {
                event.preventDefault()
                unlock(pin)
              }}
            >
              <ProfileAvatar profile={unlocking} size={72} plain />
              <PinField
                label={unlocking.locked ? t('profiles.pin') : t('profiles.parentalPin')}
                value={pin}
                onChange={next => {
                  setPin(next)
                  setPinState('idle')
                  setError(null)
                }}
                onComplete={unlock}
                state={pinState}
                autoFocus
              />
              {error && <StatusLine tone="error">{error}</StatusLine>}
              {/* No "Ouvrir": the fourth digit checks the code. */}
              <Button
                onClick={() => {
                  setUnlocking(null)
                  setError(null)
                }}
              >
                {t('common.back')}
              </Button>
            </form>
          </>
        ) : adding ? (
          <>
            <h1 className={styles.title}>{t('profiles.new')}</h1>
            <div className={styles.formBox}>
              <ProfileForm
                defaultColor={freeColor}
                kinds={admin ? ['adult', 'teen', 'child'] : ['teen', 'child']}
                onCancel={() => setAdding(false)}
                onSave={async ({ name, color, photo, kind, avatar }) => {
                  await addProfile(name, color, photo ?? null, { kind, avatar })
                  setAdding(false)
                }}
              />
            </div>
          </>
        ) : (
          <>
            <h1 className={styles.title}>{t('profiles.who')}</h1>
            <ul className={styles.grid} aria-busy={!value}>
              {profiles.map(profile => (
                <li key={profile.id}>
                  <button
                    type="button"
                    className={styles.tile}
                    onClick={() => pick(profile)}
                    disabled={opening !== null}
                    aria-current={chosen && profile.id === value?.current ? 'true' : undefined}
                  >
                    <span className={`${styles.avatar} ${opening === profile.id ? styles.opening : ''}`}>
                      <ProfileAvatar profile={profile} size={96} plain />
                      {(profile.locked || profile.parental) && (
                        <span className={styles.lock}>
                          <Lock size={13} aria-label={t('profiles.locked')} />
                        </span>
                      )}
                    </span>
                    <span className={styles.name}>{profile.name}</span>
                  </button>
                </li>
              ))}
              {value && parent && profiles.length < MAX_PROFILES && (
                <li>
                  <button type="button" className={styles.tile} onClick={() => setAdding(true)}>
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

            {error && (
              <StatusLine tone="error" className={styles.error}>
                {error}
              </StatusLine>
            )}

            {chosen && !closed && (
              <Button icon={Settings} href={settingsHref('profiles')} className={styles.manage}>
                {t('profiles.manage')}
              </Button>
            )}
          </>
        )}
      </div>
      <Copyright />
    </main>
  )
}

export default ProfilePicker
