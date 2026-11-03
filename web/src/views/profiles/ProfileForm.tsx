import { typesAtOnce } from '../../lib/use-media.ts'
import { Camera, KeyRound, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_PROFILE_NAME_LENGTH,
  PROFILE_AVATARS,
  PROFILE_COLORS,
  type Profile,
  type ProfileAvatarName,
  type ProfileColor,
  type ProfileKind,
  profilePhotoUrl
} from '../../api.ts'
import { avatarUrl } from '../../lib/avatars.ts'
import { MAX_PICKED_PHOTO_BYTES, dataUrlOf, makePhoto, PHOTO_ACCEPT, useProfiles } from '../../lib/profiles.ts'
import Button from '../../ui/Button.tsx'
import ColorSwatches from '../../ui/ColorSwatches.tsx'
import ProfileAvatar from '../../ui/ProfileAvatar.tsx'
import Segmented from '../../ui/Segmented.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import settingsStyles from '../settings/Settings.module.css'
import styles from './ProfileForm.module.css'

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
  onResetPin?: () => void
}

// A profile's name, type, colour and photo, or a child's drawn avatar: to add one, or change it.
const ProfileForm = ({
  profile,
  defaultColor = 'monde',
  kinds = [],
  nameFixed = false,
  initial,
  submitLabel,
  cancelLabel,
  className = '',
  onSave,
  onCancel,
  onDelete,
  onResetPin
}: ProfileFormProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState(profile?.name ?? initial?.name ?? '')
  const [color, setColor] = useState<ProfileColor>(profile?.color ?? initial?.color ?? defaultColor)
  const [kind, setKind] = useState<ProfileKind>(profile?.kind ?? kinds[0] ?? 'adult')
  const others = useProfiles()?.profiles.filter(other => other.id !== profile?.id) ?? []
  // A new child starts with an avatar nobody wears.
  const [avatar, setAvatar] = useState<ProfileAvatarName>(
    profile?.avatar ?? PROFILE_AVATARS.find(name => !others.some(other => other.avatar === name)) ?? 'fox'
  )
  // The Enfant interface is being redone: a new child profile waits for it, one already made keeps working.
  const soon = kind === 'child' && profile?.kind !== 'child'
  const child = kind === 'child' && !soon
  const [photo, setPhoto] = useState<Blob | null | undefined>(initial?.photo ?? undefined)
  // What the avatar shows: the photo picked, none, or (undefined) the one kept on the server.
  const [preview, setPreview] = useState<string | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // A photo picked before going back: shown again.
  useEffect(() => {
    if (initial?.photo) void dataUrlOf(initial.photo).then(setPreview)
  }, [initial?.photo])

  const hasPhoto = preview === undefined ? Boolean(profile && profilePhotoUrl(profile)) : preview !== null

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (file.size > MAX_PICKED_PHOTO_BYTES) {
      setError(t('profileForm.photoTooBig'))
      return
    }
    try {
      const made = await makePhoto(file)
      setPhoto(made)
      setPreview(await dataUrlOf(made))
    } catch {
      setError(t('profileForm.photoUnreadable'))
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
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
        photo: child ? undefined : photo
      })
    } catch {
      setError(t('profileForm.saveFailed'))
      setSaving(false)
    }
  }

  const removePhoto = () => {
    setPhoto(profile?.photoVersion == null ? undefined : null)
    setPreview(null)
  }

  return (
    <form className={`${styles.form} ${className}`} onSubmit={submit}>
      <div className={styles.layout}>
        {child ? (
          // A child has no photo: its avatar, picked beside, shows here.
          <div className={styles.photo}>
            <ProfileAvatar
              profile={{ id: profile?.id ?? 0, name: name || '?', color, photoVersion: null, avatar }}
              size={88}
              plain
            />
          </div>
        ) : (
          // The avatar is the photo's button: its camera badge says so.
          <div className={styles.photo}>
            <button
              type="button"
              className={styles.avatarButton}
              aria-label={hasPhoto ? t('profileForm.changePhoto') : t('profileForm.addPhoto')}
              onClick={() => input.current?.click()}
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
              <Button look="danger" compact icon={Trash2} onClick={removePhoto}>
                {t('profileForm.removePhoto')}
              </Button>
            )}
            <input
              ref={input}
              type="file"
              accept={PHOTO_ACCEPT}
              hidden
              onChange={event => {
                void pick(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
        )}

        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.label}>{t('profileForm.name')}</span>
            <input
              type="text"
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={MAX_PROFILE_NAME_LENGTH}
              autoComplete="off"
              autoFocus={!profile && typesAtOnce()}
              readOnly={nameFixed}
              required
              placeholder={t('profileForm.namePlaceholder')}
            />
          </label>

          {kinds.length > 1 && (
            <div className={styles.field}>
              <span className={styles.label}>{t('profileForm.type')}</span>
              <Segmented
                label={t('profileForm.type')}
                value={kind}
                onChange={setKind}
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
                <StatusLine tone="info">{t(`profileForm.kindHints.${kind}`)}</StatusLine>
              )}
            </div>
          )}

          {child && (
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
                    onClick={() => setAvatar(option)}
                  >
                    <img src={avatarUrl(option) ?? undefined} alt="" />
                  </button>
                ))}
              </div>
            </fieldset>
          )}

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
              onChange={setColor}
            />
          </fieldset>

          {onResetPin && (
            // The same row as the Sécurité card of one's own profile: the state, and what the admin can do.
            <div className={styles.field}>
              <span className={styles.label}>{t('profileForm.security')}</span>
              <div className={settingsStyles.card}>
                <SettingRow label={t('profileForm.private')} hint={t('profileForm.privateHint')}>
                  <Button icon={KeyRound} onClick={onResetPin}>
                    {t('profileForm.removePin')}
                  </Button>
                </SettingRow>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <StatusLine tone="error">{error}</StatusLine>}

      {/* Under a line: Supprimer first, away from Enregistrer, then Annuler; the primary action alone on the right. */}
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
        <Button type="submit" look="primary" busy={saving} disabled={!name.trim() || soon}>
          {submitLabel ?? (profile ? t('common.save') : t('profileForm.create'))}
        </Button>
      </div>
    </form>
  )
}

export default ProfileForm
