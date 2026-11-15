import { typesAtOnce } from '../../lib/use-media.ts'
import { Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_PROFILE_NAME_LENGTH,
  PROFILE_AVATARS,
  type Profile,
  type ProfileAvatarName,
  type ProfileColor,
  type ProfileKind
} from '../../api.ts'
import { useProfiles } from '../../lib/profiles.ts'
import Button from '../../ui/Button.tsx'
import ProfileAvatar from '../../ui/ProfileAvatar.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import styles from './ProfileForm.module.css'
import { AccountRows, AvatarPicker, ColorField, KindField, PhotoPicker, useProfilePhoto } from './ProfileFormParts.tsx'

export interface ProfileDraft {
  name: string
  color: ProfileColor
  kind?: ProfileKind
  // A child's.
  avatar?: ProfileAvatarName
  // undefined: unchanged; null: removed.
  photo?: Blob | null
}

interface ProfileFormProps {
  // Missing: a new profile.
  profile?: Profile
  // The colour a new profile starts with: one nobody has yet.
  defaultColor?: ProfileColor
  // A young profile's own form: its name is its parents' to change.
  nameFixed?: boolean
  // The types the one filling it may pick (the admin all of them, a parent the young ones); none or one: no choice.
  kinds?: ProfileKind[]
  // What a new profile starts from: the first-run screens' answers, when going back to them.
  initial?: ProfileDraft
  // The first-run screens' "Continuer" and "Retour", with their arrows, and their wider spacing.
  submitLabel?: ReactNode
  cancelLabel?: ReactNode
  className?: string
  onSave: (draft: ProfileDraft) => Promise<void>
  onCancel?: () => void
  // Shown on an existing profile that is not the household's last.
  onDelete?: () => void
  // The admin, on a member's private profile: takes its forgotten code off.
  // The admin, on an adult profile without an account: a code for its person ("Connecter un appareil").
  onConnect?: () => void
  // An adult's forgotten password, for the admin: a code to choose a new one.
  onResetPassword?: () => void
  // « Passer le rôle d'admin »: from the household's admin, to another adult with an account.
  onMakeAdmin?: () => void
  // A new profile from « Qui lit ? »: picking Adulte invites one with a code instead, so that it has its account.
  onInvite?: () => void
}

interface ActionsProps {
  saving: boolean
  disabled: boolean
  label: ReactNode
  cancelLabel?: ReactNode
  onCancel?: () => void
  onDelete?: () => void
}

// Under a line: Supprimer first, away from Enregistrer, then Annuler; the primary action alone on the right.
const FormActions = ({ saving, disabled, label, cancelLabel, onCancel, onDelete }: ActionsProps) => {
  const { t } = useTranslation()
  return (
    <div className={styles.actions}>
      {onDelete && (
        <Button
          look="danger"
          icon={Trash2}
          className={styles.compact}
          onClick={onDelete}
          aria-label={t('profileForm.deleteProfile')}
        >
          <span className={styles.compactLabel}>{t('profileForm.delete')}</span>
        </Button>
      )}
      {onCancel && <Button onClick={onCancel}>{cancelLabel ?? t('common.cancel')}</Button>}
      <span className={styles.spacer} />
      <Button type="submit" look="primary" busy={saving} disabled={disabled}>
        {label}
      </Button>
    </div>
  )
}

// The name, read-only on a young profile's own form.
const NameField = ({
  name,
  isNew,
  fixed,
  onName
}: {
  name: string
  isNew: boolean
  fixed: boolean
  onName: (name: string) => void
}) => {
  const { t } = useTranslation()
  return (
    <label className={styles.field}>
      <span className={styles.label}>{t('profileForm.name')}</span>
      <input
        type="text"
        value={name}
        onChange={event => onName(event.target.value)}
        maxLength={MAX_PROFILE_NAME_LENGTH}
        autoComplete="off"
        autoFocus={isNew && typesAtOnce()}
        readOnly={fixed}
        required
        placeholder={t('profileForm.namePlaceholder')}
      />
    </label>
  )
}

interface PictureProps {
  profile?: Profile
  name: string
  color: ProfileColor
  // A child's: it has no photo.
  avatar: ProfileAvatarName | null
  photo: ReturnType<typeof useProfilePhoto>
}

const ProfilePicture = ({ profile, name, color, avatar, photo }: PictureProps) =>
  avatar ? (
    // A child has no photo: its avatar, picked beside, shows here.
    <div className={styles.photo}>
      <ProfileAvatar
        profile={{ id: profile?.id ?? 0, name: name || '?', color, photoVersion: null, avatar }}
        size={88}
        plain
      />
    </div>
  ) : (
    <PhotoPicker
      profile={profile}
      name={name}
      color={color}
      preview={photo.preview}
      hasPhoto={photo.hasPhoto}
      onPick={file => void photo.pick(file)}
      onRemove={photo.remove}
    />
  )

// A new child starts with an avatar nobody wears.
const firstAvatar = (profile: Profile | undefined, others: Profile[]): ProfileAvatarName =>
  profile?.avatar ?? PROFILE_AVATARS.find(name => !others.some(other => other.avatar === name)) ?? 'fox'

// The type picked, and what it leads to: an adult invited, a new child waiting, or a child with its avatar.
const useKind = (profile: Profile | undefined, kinds: ProfileKind[], canInvite: boolean) => {
  const [kind, setKind] = useState<ProfileKind>(profile?.kind ?? (canInvite ? 'teen' : kinds[0]) ?? 'adult')
  // An adult is invited, not made here: only the type and what happens next show.
  const invite = !profile && canInvite && kind === 'adult'
  // The Enfant interface is being redone: a new child profile waits for it, one already made keeps working.
  const soon = kind === 'child' && profile?.kind !== 'child'
  const child = kind === 'child' && !soon
  return { kind, setKind, invite, soon, child }
}

// A profile's name, type, colour and photo, or a child's drawn avatar: to add one, or change it.
const ProfileForm = ({
  profile,
  defaultColor = 'world',
  kinds = [],
  nameFixed = false,
  initial,
  submitLabel,
  cancelLabel,
  className = '',
  onSave,
  onCancel,
  onDelete,
  onConnect,
  onResetPassword,
  onMakeAdmin,
  onInvite
}: ProfileFormProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState(profile?.name ?? initial?.name ?? '')
  const [color, setColor] = useState<ProfileColor>(profile?.color ?? initial?.color ?? defaultColor)
  const { kind, setKind, invite, soon, child } = useKind(profile, kinds, Boolean(onInvite))
  const others = useProfiles()?.profiles.filter(other => other.id !== profile?.id) ?? []
  const [avatar, setAvatar] = useState<ProfileAvatarName>(() => firstAvatar(profile, others))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photo = useProfilePhoto(profile, initial?.photo, setError)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (invite) {
      onInvite?.()
      return
    }
    const trimmed = name.replace(/\s+/g, ' ').trim()
    if (!trimmed || soon) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: trimmed,
        color,
        kind: kinds.length > 1 ? kind : undefined,
        avatar: child ? avatar : undefined,
        photo: child ? undefined : photo.photo
      })
    } catch {
      setError(t('profileForm.saveFailed'))
      setSaving(false)
    }
  }

  return (
    <form className={`${styles.form} ${className}`} onSubmit={submit}>
      <div className={styles.layout}>
        {!invite && (
          <ProfilePicture profile={profile} name={name} color={color} avatar={child ? avatar : null} photo={photo} />
        )}
        <div className={styles.fields}>
          {!invite && <NameField name={name} isNew={!profile} fixed={nameFixed} onName={setName} />}
          {kinds.length > 1 && (
            <KindField kinds={kinds} kind={kind} color={color} soon={soon} invite={invite} onKind={setKind} />
          )}
          {child && !invite && <AvatarPicker avatar={avatar} color={color} onAvatar={setAvatar} />}
          {!invite && <ColorField color={color} onColor={setColor} />}
          <AccountRows onConnect={onConnect} onResetPassword={onResetPassword} onMakeAdmin={onMakeAdmin} />
        </div>
      </div>
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <FormActions
        saving={saving}
        disabled={!invite && (!name.trim() || soon)}
        label={
          invite ? t('profileForm.invite') : (submitLabel ?? (profile ? t('common.save') : t('profileForm.create')))
        }
        cancelLabel={cancelLabel}
        onCancel={onCancel}
        onDelete={onDelete}
      />
    </form>
  )
}

export default ProfileForm
