import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { YouthLimits } from '../api.ts'
import { clockTime } from '../lib/format.ts'
import { useCurrentProfile } from '../lib/profiles.ts'
import { PROFILES_HREF } from '../lib/use-hash-route.ts'
import { useIsPhone } from '../lib/use-media.ts'
import Button from '../ui/Button.tsx'
import Copyright from '../ui/Copyright.tsx'
import PhoneHeader from '../ui/PhoneHeader.tsx'
import ProfileAvatar from '../ui/ProfileAvatar.tsx'
import pickerStyles from './ProfilePicker.module.css'
import styles from './TimeUpPage.module.css'
import { isLinkedDevice } from '../lib/linked-device.ts'

// "À demain": a young profile whose time of the day is spent, or outside the hours its parents set. The same calm
// page as "Qui lit ?": the logo, its face, one sentence, one button. No menu and no way back: "Changer de profil"
// opens "Qui lit ?", where every adult asks for a password.
const TimeUpPage = ({ limits }: { limits: YouthLimits }) => {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const profile = useCurrentProfile()
  if (!profile) return null
  const child = profile.kind === 'child'
  const time = limits.opensAt === null ? '' : clockTime(limits.opensAt)
  const later = limits.access === 'before'
  const title = later
    ? t(child ? 'limits.laterChild' : 'limits.laterTeen', { name: profile.name })
    : t(child ? 'limits.byeChild' : 'limits.byeTeen', { name: profile.name })
  const text =
    limits.access === 'before'
      ? t('limits.before', { time })
      : limits.access === 'after'
        ? t('limits.after', { time })
        : // Without hours, it opens again at midnight: "demain" says it.
          limits.rules.window
          ? t('limits.timeUp', { time })
          : t('limits.timeUpTomorrow')

  return (
    <main className={pickerStyles.page}>
      <PhoneHeader logo className={pickerStyles.header} />
      <div className={`${pickerStyles.content} ${styles.content}`}>
        <ProfileAvatar profile={profile} size={phone ? 112 : 128} plain />
        <h1 className={`${pickerStyles.title} ${styles.title}`}>{title}</h1>
        <p className={styles.text}>{text}</p>
        {/* Its own device, linked by a parent: no other profile to open. */}
        {!isLinkedDevice() && (
          <Button icon={Users} href={PROFILES_HREF} className={styles.switch}>
            {t('limits.switch')}
          </Button>
        )}
      </div>
      <Copyright />
    </main>
  )
}

export default TimeUpPage
