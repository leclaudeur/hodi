import { Camera, Crown, KeyRound, Smartphone, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PROFILE_AVATARS,
  PROFILE_COLORS,
  type Profile,
  type ProfileAvatarName,
  type ProfileColor,
  type ProfileKind,
  profilePhotoUrl
} from '../../api.ts'
import { avatarUrl } from '../../lib/avatars.ts'
import { MAX_PICKED_PHOTO_BYTES, dataUrlOf, makePhoto, PHOTO_ACCEPT } from '../../lib/profiles.ts'
import Button from '../../ui/Button.tsx'
import ColorSwatches from '../../ui/ColorSwatches.tsx'
import ProfileAvatar from '../../ui/ProfileAvatar.tsx'
import Segmented from '../../ui/Segmented.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import settingsStyles from '../settings/Settings.module.css'
import styles from './ProfileForm.module.css'

// The photo picked (undefined: unchanged; null: removed), what the avatar shows, and the ways to change it.
export const useProfilePhoto = (
  profile: Profile | undefined,
  initialPhoto: Blob | null | undefined,
  onError: (error: string | null) => void
) => {
  const { t } = useTranslation()
  const [photo, setPhoto] = useState<Blob | null | undefined>(initialPhoto ?? undefined)
  // What the avatar shows: the photo picked, none, or (undefined) the one kept on the server.
  const [preview, setPreview] = useState<string | null | undefined>(undefined)

  // A photo picked before going back: shown again.
  useEffect(() => {
    if (initialPhoto) void dataUrlOf(initialPhoto).then(setPreview)
  }, [initialPhoto])

  const hasPhoto = preview === undefined ? Boolean(profile && profilePhotoUrl(profile)) : preview !== null

  const pick = async (file: File | undefined) => {
    if (!file) return
    onError(null)
    if (file.size > MAX_PICKED_PHOTO_BYTES) {
      onError(t('profileForm.photoTooBig'))
      return
    }
    try {
      const made = await makePhoto(file)
      setPhoto(made)
      setPreview(await dataUrlOf(made))
    } catch {
      onError(t('profileForm.photoUnreadable'))
    }
  }

  const remove = () => {
    setPhoto(profile?.photoVersion == null ? undefined : null)
    setPreview(null)
  }

  return { photo, preview, hasPhoto, pick, remove }
}

interface PhotoProps {
  profile?: Profile
  name: string
  color: ProfileColor
  preview: string | null | undefined
  hasPhoto: boolean
  onPick: (file: File | undefined) => void
  onRemove: () => void
}

// The avatar is the photo's button: its camera badge says so.
export const PhotoPicker = ({ profile, name, color, preview, hasPhoto, onPick, onRemove }: PhotoProps) => {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className={styles.photo}>
      <button
        type="button"
        className={styles.avatarButton}
        aria-label={hasPhoto ? t('profileForm.changePhoto') : t('profileForm.addPhoto')}
        onClick={() => inputRef.current?.click()}
      >
        <ProfileAvatar
          profile={{
            id: profile?.id ?? 0,
            name: name || '?',
            color,
            photoVersion: profile?.photoVersion ?? null
          }}
          size={88}
          preview={preview}
          plain
        />
        <span className={styles.badge} aria-hidden="true">
          <Camera size={16} />
        </span>
      </button>
      <span className={styles.photoHint}>
        JPEG, PNG ou WebP<span className={styles.hintDot}> · </span>
        <span className={styles.hintSize}>{t('profileForm.photoMax')}</span>
      </span>
      {hasPhoto && (
        <Button look="danger" compact icon={Trash2} onClick={onRemove}>
          {t('profileForm.removePhoto')}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        hidden
        onChange={event => {
          onPick(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}

interface KindProps {
  kinds: ProfileKind[]
  kind: ProfileKind
  color: ProfileColor
  soon: boolean
  invite: boolean
  onKind: (kind: ProfileKind) => void
}

// The profile's type, with what it means; a new child waits for the Enfant interface.
export const KindField = ({ kinds, kind, color, soon, invite, onKind }: KindProps) => {
  const { t } = useTranslation()
  return (
    <div className={styles.field}>
      <span className={styles.label}>{t('profileForm.type')}</span>
      <Segmented
        label={t('profileForm.type')}
        value={kind}
        onChange={onKind}
        wide
        options={kinds.map(option => ({ value: option, label: t(`profileForm.kinds.${option}`) }))}
      />
      {soon ? (
        <div className={styles.soon}>
          <span className={styles.soonAvatar} data-topic={color}>
            <img src={avatarUrl('fox') ?? undefined} alt="" />
          </span>
          <span className={styles.soonText}>
            <b>{t('profileForm.childSoon.title')}</b>
            <span>{t('profileForm.childSoon.text')}</span>
          </span>
        </div>
      ) : (
        <StatusLine tone="info">{invite ? t('profileForm.inviteHint') : t(`profileForm.kindHints.${kind}`)}</StatusLine>
      )}
    </div>
  )
}

interface AvatarProps {
  avatar: ProfileAvatarName
  color: ProfileColor
  onAvatar: (avatar: ProfileAvatarName) => void
}

// A child's drawn avatar, in its colour.
export const AvatarPicker = ({ avatar, color, onAvatar }: AvatarProps) => {
  const { t } = useTranslation()
  return (
    <fieldset className={styles.colors}>
      <legend className={styles.label}>{t('profileForm.avatar')}</legend>
      <div className={styles.avatars} role="group" aria-label={t('profileForm.avatar')} data-topic={color}>
        {PROFILE_AVATARS.map(option => (
          <button
            key={option}
            type="button"
            className={styles.avatarOption}
            aria-pressed={option === avatar}
            aria-label={t(`profileForm.avatars.${option}`)}
            title={t(`profileForm.avatars.${option}`)}
            onClick={() => onAvatar(option)}
          >
            <img src={avatarUrl(option) ?? undefined} alt="" />
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export const ColorField = ({ color, onColor }: { color: ProfileColor; onColor: (color: ProfileColor) => void }) => {
  const { t } = useTranslation()
  return (
    <fieldset className={styles.colors}>
      <legend className={styles.label}>{t('profileForm.color')}</legend>
      <ColorSwatches
        row
        label={t('profileForm.color')}
        value={color}
        options={PROFILE_COLORS.map(option => ({
          value: option,
          name: t(`profileForm.colors.${option}`),
          color: `var(--topic-${option})`
        }))}
        onChange={onColor}
      />
    </fieldset>
  )
}

interface AccountProps {
  onConnect?: () => void
  onResetPassword?: () => void
  onMakeAdmin?: () => void
}

const AccountRow = ({ label, hint, children }: { label: string; hint: string; children: ReactNode }) => (
  <SettingRow label={label} hint={hint} className={settingsStyles.stackedRow}>
    {children}
  </SettingRow>
)

// An adult's account, for the admin: a code to connect it or to choose a new password, and the admin role.
// Nothing on a profile that is not an adult's, or for one who is not the admin.
export const AccountRows = ({ onConnect, onResetPassword, onMakeAdmin }: AccountProps) => {
  const { t } = useTranslation()
  if (!onConnect && !onResetPassword) return null
  return (
    <div className={styles.field}>
      <span className={styles.label}>{t('profileForm.account')}</span>
      <div className={settingsStyles.card}>
        {/* Under its text, full width: beside it, the button leaves the hint two words a line. */}
        {onConnect ? (
          <AccountRow label={t('profileForm.noAccount')} hint={t('profileForm.noAccountHint')}>
            <Button icon={Smartphone} wide onClick={onConnect}>
              {t('profileForm.connect')}
            </Button>
          </AccountRow>
        ) : (
          <AccountRow label={t('profileForm.forgotPassword')} hint={t('profileForm.forgotPasswordHint')}>
            <Button icon={KeyRound} wide onClick={onResetPassword}>
              {t('profileForm.newPassword')}
            </Button>
          </AccountRow>
        )}
        {onMakeAdmin && (
          <AccountRow label={t('profileForm.makeAdmin')} hint={t('profileForm.makeAdminHint')}>
            <Button icon={Crown} wide onClick={onMakeAdmin}>
              {t('profileForm.makeAdminButton')}
            </Button>
          </AccountRow>
        )}
      </div>
    </div>
  )
}
