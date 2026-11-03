import { ChevronsUpDown, Lock, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_PROFILES, PIN_PATTERN, PROFILE_COLORS, type Profile, RequestError } from '../api.ts'
import { t as textNow } from '../lib/i18n.ts'
import { addProfile, switchProfile, useProfiles } from '../lib/profiles.ts'
import { showError, showSaved } from '../lib/toast.ts'
import Button from '../ui/Button.tsx'
import Dialog from '../ui/Dialog.tsx'
import Menu, { MenuItem } from '../ui/Menu.tsx'
import DialogActions from '../ui/DialogActions.tsx'
import PinField, { type PinState } from '../ui/PinField.tsx'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import { Bar } from '../ui/Skeleton.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import ProfileForm from '../views/profiles/ProfileForm.tsx'
import styles from './ProfileSwitcher.module.css'
import RichText from '../ui/RichText.tsx'

// A private profile's code, or the Code parental, asked before it opens.
const PinDialog = ({ profile, onClose }: { profile: Profile; onClose: () => void }) => {
  const { t } = useTranslation()
  const [pin, setPin] = useState('')
  const [state, setState] = useState<PinState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  const unlock = async (code: string) => {
    if (!PIN_PATTERN.test(code) || opening) return
    setOpening(true)
    try {
      const opened = async () => {
        setState('right')
        await new Promise(resolve => setTimeout(resolve, 450))
      }
      if ((await switchProfile(profile.id, true, code, opened)) === 'pending') {
        setError(t('profiles.pending'))
        setOpening(false)
      }
    } catch (failure) {
      if (failure instanceof RequestError && failure.code === 'wrong_pin') {
        setError(t('profiles.wrongPin'))
        setState('wrong')
      } else if (failure instanceof RequestError && failure.code === 'too_many_attempts')
        setError(
          t('common.tooManyAttempts', { minutes: Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 60) / 60)) })
        )
      else setError(t('profiles.openFailed'))
      setPin('')
      setOpening(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={profile.name}
      intro={
        <RichText
          i18nKey={profile.locked ? 'dialogIntro.pinOpen' : 'dialogIntro.parentalOpen'}
          values={{ name: profile.name }}
        />
      }
    >
      <form
        className={styles.pin}
        onSubmit={event => {
          event.preventDefault()
          void unlock(pin)
        }}
      >
        <ProfileAvatar profile={profile} size={72} plain />
        <PinField
          label={profile.locked ? t('profiles.pin') : t('profiles.parentalPin')}
          value={pin}
          onChange={next => {
            setPin(next)
            setState('idle')
            setError(null)
          }}
          onComplete={code => void unlock(code)}
          state={state}
          autoFocus
        />
        {error && <StatusLine tone="error">{error}</StatusLine>}
      </form>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
      </DialogActions>
    </Dialog>
  )
}

// The sidebar's way to change profile on a computer: the open one, and a menu of the others above it. A private
// profile asks its code; the admin can add one from here, as in Réglages > Profils.
const ProfileSwitcher = () => {
  const { t } = useTranslation()
  const value = useProfiles({ onError: () => {} })
  const [open, setOpen] = useState(false)
  const [unlocking, setUnlocking] = useState<Profile | null>(null)
  const [adding, setAdding] = useState(false)
  const selector = useRef<HTMLButtonElement>(null)

  const profiles = value?.profiles ?? []
  const current = profiles.find(profile => profile.id === value?.current)
  // While the profiles arrive: the selector's shape, its face and name in grey.
  if (!current)
    return (
      <div className={styles.switcher} aria-hidden="true">
        <span className={`${styles.selector} ${styles.waiting}`}>
          <Bar width={28} height={28} radius={14} />
          <Bar width={72} height={10} />
        </span>
      </div>
    )
  const admin = current.role === 'admin'
  // Young profiles are added by any adult, the others by the admin.
  const parent = current.kind === 'adult'
  const freeColor = PROFILE_COLORS.find(color => !profiles.some(profile => profile.color === color))

  const pick = (profile: Profile) => {
    setOpen(false)
    if (profile.id === current.id) return
    if (profile.locked || profile.parental) {
      setUnlocking(profile)
      return
    }
    switchProfile(profile.id, true)
      .then(result => result === 'pending' && showError(textNow('profiles.pending')))
      .catch(() => showError(textNow('profiles.openFailed')))
  }

  return (
    <div className={styles.switcher}>
      <Menu
        open={open}
        onClose={refocus => {
          setOpen(false)
          if (refocus) selector.current?.focus()
        }}
        label={t('profiles.switch')}
        placement="above"
        className={styles.menu}
      >
        {profiles.map(profile => (
          <MenuItem
            key={profile.id}
            lead={<ProfileAvatar profile={profile} size={28} />}
            checked={profile.id === current.id}
            // The open one has its check; the others may have their lock.
            end={
              profile.id !== current.id &&
              (profile.locked || profile.parental) && (
                <Lock size={14} className={styles.lock} aria-label={t('profiles.locked')} />
              )
            }
            onClick={() => pick(profile)}
          >
            {profile.name}
          </MenuItem>
        ))}
        {parent && profiles.length < MAX_PROFILES && (
          <MenuItem
            tone="quiet"
            lead={
              <span className={styles.plus}>
                <Plus size={16} aria-hidden="true" />
              </span>
            }
            onClick={() => {
              setOpen(false)
              setAdding(true)
            }}
          >
            {t('profiles.create')}
          </MenuItem>
        )}
      </Menu>
      <button
        ref={selector}
        type="button"
        className={styles.selector}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('profiles.switchFrom', { name: current.name })}
        onClick={() => setOpen(!open)}
      >
        <ProfileAvatar profile={current} size={28} />
        <span className={styles.name}>{current.name}</span>
        <ChevronsUpDown size={16} className={styles.chevrons} aria-hidden="true" />
      </button>

      {unlocking && <PinDialog profile={unlocking} onClose={() => setUnlocking(null)} />}
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('profiles.new')}>
        {adding && (
          <ProfileForm
            defaultColor={freeColor}
            kinds={admin ? ['adult', 'teen', 'child'] : ['teen', 'child']}
            onCancel={() => setAdding(false)}
            onSave={async ({ name, color, photo, kind, avatar }) => {
              await addProfile(name, color, photo ?? null, { kind, avatar })
              setAdding(false)
              showSaved(textNow('profiles.added', { name }))
            }}
          />
        )}
      </Dialog>
    </div>
  )
}

export default ProfileSwitcher
