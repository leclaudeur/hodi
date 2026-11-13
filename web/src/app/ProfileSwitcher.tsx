import { ChevronsUpDown, Lock, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_PROFILES, PROFILE_COLORS, type Profile, RequestError } from '../api.ts'
import { t as textNow } from '../lib/i18n.ts'
import { addProfile, switchProfile, useProfiles } from '../lib/profiles.ts'
import { showError, showSaved } from '../lib/toast.ts'
import Button from '../ui/Button.tsx'
import Dialog from '../ui/Dialog.tsx'
import Menu, { MenuItem, MenuSeparator } from '../ui/Menu.tsx'
import DialogActions from '../ui/DialogActions.tsx'
import PasswordField from '../ui/PasswordField.tsx'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import { Bar } from '../ui/Skeleton.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import CodeDialog from '../views/profiles/CodeDialog.tsx'
import ProfileForm from '../views/profiles/ProfileForm.tsx'
import styles from './ProfileSwitcher.module.css'
import RichText from '../ui/RichText.tsx'
import { isLinkedDevice } from '../lib/linked-device.ts'
import { useAvatarMenu } from '../plugins/Slots.tsx'

// The password an adult profile asks for here before it opens: its own person's.
const PasswordDialog = ({ profile, own, onClose }: { profile: Profile; own: number | null; onClose: () => void }) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const theirs = profile.hasAccount && profile.id !== own
  const label = theirs ? t('profiles.passwordOf', { name: profile.name }) : t('profiles.yourPassword')

  const unlock = async () => {
    if (!password || opening) return
    setOpening(true)
    try {
      if ((await switchProfile(profile.id, true, password)) === 'pending') {
        setError(t('profiles.pending'))
        setOpening(false)
      }
    } catch (failure) {
      if (failure instanceof RequestError && failure.code === 'wrong_password') {
        setError(t('profiles.wrongPassword'))
        setWrong(true)
      } else if (failure instanceof RequestError && failure.code === 'too_many_attempts')
        setError(
          t('common.tooManyAttempts', { minutes: Math.max(1, Math.ceil((failure.retryAfterSeconds ?? 60) / 60)) })
        )
      else setError(t('profiles.openFailed'))
      setPassword('')
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
          i18nKey={theirs ? 'dialogIntro.passwordOpen' : 'dialogIntro.ownOpen'}
          values={{ name: profile.name }}
        />
      }
    >
      <form
        id="profile-password"
        className={styles.pin}
        onSubmit={event => {
          event.preventDefault()
          void unlock()
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
            setWrong(false)
            setError(null)
          }}
          invalid={wrong}
        />
        {error && <StatusLine tone="error">{error}</StatusLine>}
      </form>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" form="profile-password" look="primary" busy={opening} disabled={!password}>
          {t('profiles.open')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// The menu spans the footer's row, from the selector to the settings' round button at its end.
const footerRow = (wrapper: HTMLElement) => ({
  contextElement: wrapper,
  getBoundingClientRect: () => {
    const selector = wrapper.getBoundingClientRect()
    const end = wrapper.parentElement?.lastElementChild?.getBoundingClientRect().right ?? selector.right
    return new DOMRect(selector.left, selector.top, end - selector.left, selector.height)
  }
})

// While the profiles arrive: the selector's shape, its face and name in grey.
const Waiting = () => (
  <div className={styles.switcher} aria-hidden="true">
    <span className={`${styles.selector} ${styles.waiting}`}>
      <Bar width={28} height={28} radius={14} />
      <Bar width={72} height={10} />
    </span>
  </div>
)

// A young profile's own device: its face and name, nothing to switch to.
const Still = ({ current }: { current: Profile }) => (
  <div className={styles.switcher}>
    <span className={`${styles.selector} ${styles.still}`}>
      <ProfileAvatar profile={current} size={28} />
      <span className={styles.name}>{current.name}</span>
    </span>
  </div>
)

// The new profile's form, and "Inviter un adulte" from it.
const AddProfile = ({
  adding,
  setAdding,
  profiles
}: {
  adding: boolean
  setAdding: (adding: boolean) => void
  profiles: Profile[]
}) => {
  const { t } = useTranslation()
  const [inviting, setInviting] = useState(false)
  const freeColor = PROFILE_COLORS.find(color => !profiles.some(profile => profile.color === color))
  return (
    <>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('profiles.new')}>
        {adding && (
          <ProfileForm
            defaultColor={freeColor}
            kinds={['adult', 'teen', 'child']}
            onInvite={() => {
              setAdding(false)
              setInviting(true)
            }}
            onCancel={() => setAdding(false)}
            onSave={async ({ name, color, photo, kind, avatar }) => {
              await addProfile(name, color, photo ?? null, { kind, avatar })
              setAdding(false)
              showSaved(textNow('profiles.added', { name }))
            }}
          />
        )}
      </Dialog>
      <CodeDialog
        key={inviting ? 'invite' : 'closed'}
        target={inviting ? null : undefined}
        onClose={() => setInviting(false)}
      />
    </>
  )
}

interface ProfileMenuProps {
  open: boolean
  onClose: (refocus: boolean) => void
  profiles: Profile[]
  current: Profile
  onPick: (profile: Profile) => void
  onAdd: () => void
}

// The household's profiles, then "Nouveau profil" for an adult, then the plugins' entries.
const ProfileMenu = ({ open, onClose, profiles, current, onPick, onAdd }: ProfileMenuProps) => {
  const { t } = useTranslation()
  // A plugin's entries (« Changer de foyer »), after Hodi's.
  const pluginEntries = useAvatarMenu()
  // Young profiles are added here by any adult; an adult joins with "Inviter un adulte", so that it has its account.
  const parent = current.kind === 'adult'
  return (
    <Menu
      open={open}
      onClose={onClose}
      label={t('profiles.switch')}
      placement="above"
      align="stretch"
      anchor={footerRow}
    >
      {profiles.map(profile => (
        <MenuItem
          key={profile.id}
          lead={<ProfileAvatar profile={profile} size={28} />}
          checked={profile.id === current.id}
          // The open one has its check; the others may have their lock.
          end={
            profile.id !== current.id &&
            profile.locked && <Lock size={14} className={styles.lock} aria-label={t('profiles.locked')} />
          }
          onClick={() => onPick(profile)}
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
          onClick={onAdd}
        >
          {t('profiles.create')}
        </MenuItem>
      )}
      {/* The plugins' entries are actions, not profiles: under a line, quiet, their icon in a plain round. */}
      {pluginEntries.length > 0 && <MenuSeparator />}
      {pluginEntries.map(entry => (
        <MenuItem
          key={entry.key}
          tone="quiet"
          lead={<span className={styles.action}>{entry.icon}</span>}
          onClick={() => {
            onClose(false)
            entry.onClick()
          }}
        >
          {entry.label}
        </MenuItem>
      ))}
    </Menu>
  )
}

// The sidebar's way to change profile on a computer: the open one, and a menu of the others above it. A private
// adult profile asks its password; any adult adds a young profile from here, or invites an adult.
const ProfileSwitcher = () => {
  const { t } = useTranslation()
  const value = useProfiles({ onError: () => {} })
  const [open, setOpen] = useState(false)
  const [unlocking, setUnlocking] = useState<Profile | null>(null)
  const [adding, setAdding] = useState(false)
  const selector = useRef<HTMLButtonElement>(null)

  const profiles = value?.profiles ?? []
  const current = profiles.find(profile => profile.id === value?.current)
  if (!current) return <Waiting />
  if (isLinkedDevice()) return <Still current={current} />

  const pick = (profile: Profile) => {
    setOpen(false)
    if (profile.id === current.id) return
    if (profile.locked && !profile.hasAccount) {
      showError(textNow('profiles.noAccount', { name: profile.name }))
      return
    }
    if (profile.locked) {
      setUnlocking(profile)
      return
    }
    switchProfile(profile.id, true)
      .then(result => result === 'pending' && showError(textNow('profiles.pending')))
      .catch(() => showError(textNow('profiles.openFailed')))
  }

  return (
    <div className={styles.switcher}>
      <ProfileMenu
        open={open}
        onClose={refocus => {
          setOpen(false)
          if (refocus) selector.current?.focus()
        }}
        profiles={profiles}
        current={current}
        onPick={pick}
        onAdd={() => {
          setOpen(false)
          setAdding(true)
        }}
      />
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

      {unlocking && <PasswordDialog profile={unlocking} own={value?.own ?? null} onClose={() => setUnlocking(null)} />}
      <AddProfile adding={adding} setAdding={setAdding} profiles={profiles} />
    </div>
  )
}

export default ProfileSwitcher
