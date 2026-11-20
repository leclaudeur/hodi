import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Copyright from '../ui/Copyright.tsx'
import PhoneHeader from '../ui/PhoneHeader.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import AddAccountPage from './AddAccountPage.tsx'
import { Who, useOpening } from './ProfilePickerParts.tsx'
import { Unlock } from './ProfileUnlock.tsx'
import styles from './ProfilePicker.module.css'

interface ProfilePickerProps {
  // False: the first visit since profiles exist, or the profile was deleted. Nothing to go back to.
  chosen: boolean
  // The current profile's time is up ("À demain"): no way back to the feed or its settings, only another profile.
  closed?: boolean
  onUnauthorized: () => void
}

// "Qui lit ?": the profiles of the accounts signed in on this device and the household's young ones, Netflix style.
// Picking one opens Hodi as that reader; « Ajouter » signs one more account in here.
const ProfilePicker = ({ chosen, closed = false, onUnauthorized }: ProfilePickerProps) => {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const opening = useOpening(chosen, onUnauthorized)

  if (adding) return <AddAccountPage onBack={() => setAdding(false)} />

  return (
    <main className={styles.page}>
      <PhoneHeader
        back={
          chosen &&
          !closed && (
            // On a computer it matches the sidebar's avatar and search buttons; 44 is for touch.
            <RoundButton icon={ArrowLeft} label={t('nav.backToFeed')} size={44} href="#/" />
          )
        }
        logo={chosen && !closed ? '#/' : true}
        className={styles.header}
      />
      <div className={styles.content}>
        {opening.unlocking ? (
          <Unlock key={opening.unlocking.id} opening={opening} profile={opening.unlocking} />
        ) : (
          <Who opening={opening} chosen={chosen} onAdd={() => setAdding(true)} />
        )}
      </div>
      <Copyright />
    </main>
  )
}

export default ProfilePicker
