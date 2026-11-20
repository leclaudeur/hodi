import { SlidersHorizontal } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { Profile } from '../../../api.ts'
import { isYoung } from '../../../lib/profiles.ts'
import { youngProfileHref } from '../../../lib/use-hash-route.ts'
import Chip from '../../../ui/Chip.tsx'
import ProfileAvatarButton from '../../../ui/ProfileAvatarButton.tsx'
import styles from '../Settings.module.css'
import { RowButton } from '../SettingRow.tsx'
import { formatMinutes } from './young/format.ts'
import { useTranslation } from 'react-i18next'

// Under a name: a young profile's time a day for its parents, else its type.
export const hintOf = (profile: Profile, parent: boolean, daily: Map<number, number | null>, t: TFunction) => {
  if (parent && isYoung(profile)) {
    const minutes = daily.get(profile.id)
    if (minutes === undefined) return t(`profileForm.kinds.${profile.kind}`)
    return minutes === null ? t('young.noLimit') : t('young.perDay', { time: formatMinutes(minutes) })
  }
  return t(`profileForm.kinds.${profile.kind}`)
}

interface ProfileRowProps {
  profile: Profile
  active: boolean
  // A parent manages a young profile on its own page.
  managed: boolean
  hint: string
}

export const ProfileRow = ({ profile, active, managed, hint }: ProfileRowProps) => {
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
        <RowButton
          label={t('young.manage')}
          ariaLabel={t('young.manageLabel', { name: profile.name })}
          icon={SlidersHorizontal}
          href={youngProfileHref(profile.id)}
        />
      )}
    </li>
  )
}
