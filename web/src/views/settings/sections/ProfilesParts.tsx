import { Pencil, SlidersHorizontal } from 'lucide-react'
import type { TFunction } from 'i18next'
import { PROFILE_COLORS, type Profile, type ProfileKind, createSignInCode, makeAdmin } from '../../../api.ts'
import { addProfile, editProfile, isYoung, removeProfile } from '../../../lib/profiles.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import { youngProfileHref } from '../../../lib/use-hash-route.ts'
import Chip from '../../../ui/Chip.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import ProfileAvatarButton from '../../../ui/ProfileAvatarButton.tsx'
import RichText from '../../../ui/RichText.tsx'
import ProfileForm from '../../profiles/ProfileForm.tsx'
import styles from '../Settings.module.css'
import { RowButton } from '../SettingRow.tsx'
import { formatMinutes } from './young/format.ts'
import { useTranslation } from 'react-i18next'

// "Inviter un adulte" (null) or "Connecter un appareil" for a profile; undefined: neither.
export type Giving = { id: number; name: string; reset?: boolean; made?: { code: string } } | null | undefined

// The types one may give: the admin any (its own profile stays an adult), a parent the young ones.
export const kindsOf = (profile: Profile | undefined, current: number | null, admin: boolean): ProfileKind[] => {
  if (profile?.role === 'admin' || (profile && profile.id === current && !admin)) return []
  return admin ? ['adult', 'teen', 'child'] : ['teen', 'child']
}

// Under a name: a young profile's time a day for its parents, else its role or type.
export const hintOf = (profile: Profile, parent: boolean, daily: Map<number, number | null>, t: TFunction) => {
  if (parent && isYoung(profile)) {
    const minutes = daily.get(profile.id)
    if (minutes === undefined) return t(`profileForm.kinds.${profile.kind}`)
    return minutes === null ? t('young.noLimit') : t('young.perDay', { time: formatMinutes(minutes) })
  }
  return `${profile.role === 'admin' ? t('settings.roles.admin') : t(`profileForm.kinds.${profile.kind}`)}`
}

interface Confirms {
  t: TFunction
  onEditing: (editing: number | 'new' | null) => void
  onGiving: (giving: Giving) => void
}

// Removing a profile, handing over the admin role and a new password, each asked first.
export const profileConfirms = ({ t, onEditing, onGiving }: Confirms) => ({
  // An adult with an account: their account goes too, with the admin's password.
  remove: ({ id, name, hasAccount, kind }: Profile) =>
    askToConfirm({
      title: t('confirm.deleteProfile.title'),
      message: (
        <RichText
          i18nKey={
            hasAccount && kind === 'adult' ? 'confirm.deleteProfile.messageAccount' : 'confirm.deleteProfile.message'
          }
          values={{ name }}
        />
      ),
      label: t('confirm.deleteProfile.button'),
      proof: hasAccount && kind === 'adult' ? {} : undefined,
      onConfirm: async proof => {
        if (hasAccount && kind === 'adult') await removeProfile(id, proof)
        // Asked over its form: the form goes with the profile.
        onEditing(null)
        if (hasAccount && kind === 'adult') {
          showSaved(t('settings.profiles.deleted', { name }))
          return
        }
        void removeProfile(id)
          .then(() => showSaved(t('settings.profiles.deleted', { name })))
          .catch(() => showError(t('settings.profiles.deleteFailed')))
      }
    }),

  // « Passer le rôle d'admin »: one admin per household; this one becomes a member, with the password typed.
  handOver: ({ id, name }: Profile) =>
    askToConfirm({
      title: t('confirm.makeAdmin.title', { name }),
      message: <RichText i18nKey="confirm.makeAdmin.message" values={{ name }} />,
      label: t('confirm.makeAdmin.button'),
      look: 'primary',
      proof: {},
      onConfirm: async proof => {
        await makeAdmin(id, proof)
        onEditing(null)
        window.location.reload()
      }
    }),

  // « Nouveau mot de passe »: the code hands their account over, so it is made once the admin typed their own.
  reset: ({ id, name }: Profile) =>
    askToConfirm({
      title: t('confirm.resetPassword.title', { name }),
      message: <RichText i18nKey="confirm.resetPassword.message" values={{ name }} />,
      label: t('confirm.resetPassword.button'),
      proof: {},
      onConfirm: async proof => {
        const made = await createSignInCode(id, proof)
        onGiving({ id, name, reset: true, made })
      }
    })
})

interface EditActionsInput {
  admin: boolean
  current: number | null
  withAccounts: boolean
  confirms: ReturnType<typeof profileConfirms>
  onGiving: (giving: Giving) => void
}

// What the admin may do from a profile's form, beside saving it.
export const editActionsOf = (
  edited: Profile | undefined,
  { admin, current, withAccounts, confirms, onGiving }: EditActionsInput
) => {
  if (!edited || !admin) return {}
  // An adult with an account, other than the admin: a new password, or the admin role.
  const otherAccount = edited.id !== current && edited.kind === 'adult' && edited.hasAccount
  return {
    onDelete: edited.role !== 'admin' ? () => confirms.remove(edited) : undefined,
    onConnect:
      withAccounts && edited.kind === 'adult' && !edited.hasAccount
        ? () => onGiving({ id: edited.id, name: edited.name })
        : undefined,
    onResetPassword: otherAccount ? () => confirms.reset(edited) : undefined,
    onMakeAdmin: otherAccount && withAccounts ? () => confirms.handOver(edited) : undefined
  }
}

interface ProfileRowProps {
  profile: Profile
  active: boolean
  // A parent manages a young profile on its own page.
  managed: boolean
  editable: boolean
  hint: string
  onEdit: () => void
}

export const ProfileRow = ({ profile, active, managed, editable, hint, onEdit }: ProfileRowProps) => {
  const { t } = useTranslation()
  return (
    <li className={styles.row}>
      <ProfileAvatarButton profile={profile} size={44} />
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{profile.name}</span>
        <span className={styles.rowHint}>{hint}</span>
      </span>
      {active && (
        <Chip tone="success" size="row">
          {t('settings.profiles.active')}
        </Chip>
      )}
      {managed && (
        <>
          <Chip size="row">{t(`profileForm.kinds.${profile.kind}`)}</Chip>
          <RowButton
            label={t('young.manage')}
            ariaLabel={t('young.manageLabel', { name: profile.name })}
            icon={SlidersHorizontal}
            href={youngProfileHref(profile.id)}
          />
        </>
      )}
      {!managed && editable && (
        <RowButton
          label={t('settings.edit')}
          ariaLabel={t('settings.editName', { name: profile.name })}
          icon={Pencil}
          onClick={onEdit}
        />
      )}
    </li>
  )
}

interface NewProfileProps {
  open: boolean
  defaultColor: (typeof PROFILE_COLORS)[number] | undefined
  kinds: ProfileKind[]
  onClose: () => void
}

export const NewProfileDialog = ({ open, defaultColor, kinds, onClose }: NewProfileProps) => {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onClose={onClose} title={t('profiles.new')}>
      {open && (
        <ProfileForm
          defaultColor={defaultColor}
          kinds={kinds}
          onCancel={onClose}
          onSave={async ({ name, color, photo, kind, avatar }) => {
            await addProfile(name, color, photo ?? null, { kind, avatar })
            onClose()
            showSaved(t('profiles.added', { name }))
          }}
        />
      )}
    </Dialog>
  )
}

interface EditProfileProps {
  edited: Profile | undefined
  kinds: ProfileKind[]
  onClose: () => void
  onDelete?: () => void
  onConnect?: () => void
  onResetPassword?: () => void
  onMakeAdmin?: () => void
}

export const EditProfileDialog = ({ edited, kinds, onClose, ...actions }: EditProfileProps) => {
  const { t } = useTranslation()
  return (
    <Dialog open={edited !== undefined} onClose={onClose} title={t('settings.editProfileTitle')}>
      {edited && (
        <ProfileForm
          profile={edited}
          kinds={kinds}
          onCancel={onClose}
          {...actions}
          onSave={async ({ name, color, photo, kind, avatar }) => {
            await editProfile(edited.id, { name, color, kind, avatar }, photo)
            onClose()
            showSaved(t('settings.profileSaved'))
          }}
        />
      )}
    </Dialog>
  )
}
