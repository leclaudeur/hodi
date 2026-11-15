import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Profile } from '../api.ts'
import { useHouseholdGame } from '../lib/game.ts'
import ProfileAvatar from './ProfileAvatar.tsx'
import styles from './ProfileAvatarButton.module.css'
import ProfileSheet from './ProfileSheet.tsx'

interface ProfileAvatarButtonProps {
  profile: Pick<Profile, 'id' | 'name' | 'color' | 'photoVersion'>
  size: number
}

// A profile's avatar that opens its sheet in the household game; the avatar alone while the game is off.
const ProfileAvatarButton = ({ profile, size }: ProfileAvatarButtonProps) => {
  const { t } = useTranslation()
  const game = useHouseholdGame()
  const [open, setOpen] = useState(false)
  if (!game) return <ProfileAvatar profile={profile} size={size} />
  return (
    <>
      <button
        type="button"
        className={styles.button}
        aria-label={t('profiles.of', { name: profile.name })}
        onClick={() => setOpen(true)}
      >
        <ProfileAvatar profile={profile} size={size} />
      </button>
      <ProfileSheet profile={open ? profile : null} onClose={() => setOpen(false)} />
    </>
  )
}

export default ProfileAvatarButton
