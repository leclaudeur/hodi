import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AccountView, changeHandle } from '../../../api.ts'
import { editProfile, useProfiles } from '../../../lib/profiles.ts'
import { showSaved } from '../../../lib/toast.ts'
import Dialog from '../../../ui/Dialog.tsx'
import ProfileAvatar from '../../../ui/ProfileAvatar.tsx'
import ProfileForm from '../../profiles/ProfileForm.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import LanguageRow from './LanguageRow.tsx'

interface AccountProfileProps {
  account: AccountView
  onAccount: (account: AccountView) => void
}

// Mon compte › Profil: who the account is, the same in every screen (its name, @identifier, photo and colour), and its
// language. One account reads in one household, as one profile: that profile is the account's face.
const AccountProfile = ({ account, onAccount }: AccountProfileProps) => {
  const { t } = useTranslation()
  const value = useProfiles()
  const [editing, setEditing] = useState(false)
  const own = value?.profiles.find(profile => profile.id === value.current)
  if (!own) return null
  return (
    <>
      <h2 className={styles.label}>{t('settings.account.profile')}</h2>
      <div className={styles.card}>
        <SettingRow
          lead={<ProfileAvatar profile={own} size={44} plain />}
          label={own.name}
          value={account.handle ? `@${account.handle}` : undefined}
          action={{
            label: t('settings.edit'),
            ariaLabel: t('settings.editName', { name: own.name }),
            icon: Pencil,
            onClick: () => setEditing(true)
          }}
        />
        <LanguageRow />
      </div>
      <Dialog open={editing} onClose={() => setEditing(false)} title={t('settings.editProfileTitle')}>
        {editing && (
          <ProfileForm
            profile={own}
            withHandle={{ value: account.handle ?? undefined, lockedUntil: account.handleChangeableFrom }}
            onCancel={() => setEditing(false)}
            onSave={async ({ name, color, photo, handle }) => {
              if (handle && handle !== account.handle) {
                const changed = await changeHandle(handle)
                onAccount({ ...account, handle: changed.handle, handleChangeableFrom: changed.changeableFrom })
              }
              await editProfile(own.id, { name, color }, photo)
              setEditing(false)
              showSaved(t('settings.profileSaved'))
            }}
          />
        )}
      </Dialog>
    </>
  )
}

export default AccountProfile
