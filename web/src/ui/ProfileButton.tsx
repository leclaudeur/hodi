import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHouseholdGame } from '../lib/game.ts'
import { useCurrentProfile } from '../lib/profiles.ts'
import { useIsDesktop } from '../lib/use-media.ts'
import { PROFILES_HREF } from '../lib/use-hash-route.ts'
import ProfileAvatar from './ProfileAvatar.tsx'
import styles from './ProfileButton.module.css'
import { Bar } from './Skeleton.tsx'
import ProfileSheet from './ProfileSheet.tsx'
import { isLinkedDevice } from '../lib/linked-device.ts'

// The open profile's face, in the headers. With the household game on, it opens the profile's sheet. Otherwise it
// goes back to "Qui lit ?" to switch, except on a computer, where the sidebar's selector does that: one way per device.
const ProfileButton = ({ size }: { size: number }) => {
  const { t } = useTranslation()
  const profile = useCurrentProfile()
  const game = useHouseholdGame()
  const [open, setOpen] = useState(false)
  const desktop = useIsDesktop()
  // While the profiles arrive: the face in grey, where it will be.
  if (!profile) return <Bar width={size} height={size} radius={size / 2} />
  if (game)
    return (
      <>
        <button
          type="button"
          className={styles.button}
          data-tour="profile"
          aria-label={t('profiles.yours', { name: profile.name })}
          title={profile.name}
          onClick={() => setOpen(true)}
        >
          <ProfileAvatar profile={profile} size={size} />
        </button>
        <ProfileSheet profile={open ? profile : null} onClose={() => setOpen(false)} />
      </>
    )
  // On a computer the sidebar switches; a young profile's own device has nothing to switch to.
  if (desktop || isLinkedDevice())
    return (
      <span className={styles.still} title={profile.name}>
        <ProfileAvatar profile={profile} size={size} />
      </span>
    )
  return (
    <a
      className={styles.button}
      href={PROFILES_HREF}
      aria-label={t('profiles.switchFrom', { name: profile.name })}
      title={profile.name}
    >
      <ProfileAvatar profile={profile} size={size} />
    </a>
  )
}

export default ProfileButton
