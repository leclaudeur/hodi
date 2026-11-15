import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PROFILE_COLORS } from '../api.ts'
import { addProfile } from '../lib/profiles.ts'
import Copyright from '../ui/Copyright.tsx'
import PhoneHeader from '../ui/PhoneHeader.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import CodeDialog from '../views/profiles/CodeDialog.tsx'
import ProfileForm from '../views/profiles/ProfileForm.tsx'
import { Unlock, Who, useOpening } from './ProfilePickerParts.tsx'
import styles from './ProfilePicker.module.css'

interface ProfilePickerProps {
  // False: the first visit since profiles exist, or the profile was deleted. Nothing to go back to.
  chosen: boolean
  // The current profile's time is up ("À demain"): no way back to the feed or its settings, only another profile.
  closed?: boolean
  onUnauthorized: () => void
}

// "Qui lit ?": the household's profiles, Netflix style. Picking one opens Hodi as that reader.
const ProfilePicker = ({ chosen, closed = false, onUnauthorized }: ProfilePickerProps) => {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  // "Inviter un adulte", from the new profile's form.
  const [inviting, setInviting] = useState(false)
  const opening = useOpening(chosen, onUnauthorized)
  const profiles = opening.value?.profiles ?? []
  const freeColor = PROFILE_COLORS.find(color => !profiles.some(profile => profile.color === color))

  let content
  if (opening.unlocking) content = <Unlock opening={opening} profile={opening.unlocking} />
  else if (adding) {
    content = (
      <>
        <h1 className={styles.title}>{t('profiles.new')}</h1>
        <div className={styles.formBox}>
          <ProfileForm
            defaultColor={freeColor}
            kinds={['adult', 'teen', 'child']}
            onInvite={() => {
              setAdding(false)
              setInviting(true)
            }}
            onCancel={() => setAdding(false)}
            onSave={async ({ name, color, photo, kind, avatar }) => {
              await addProfile(name, color, photo ?? null, { kind, avatar })
              setAdding(false)
            }}
          />
        </div>
      </>
    )
  } else content = <Who opening={opening} chosen={chosen} closed={closed} onAdd={() => setAdding(true)} />

  return (
    <main className={styles.page}>
      <PhoneHeader
        back={
          chosen &&
          !closed &&
          !adding && (
            // On a computer it matches the sidebar's avatar and search buttons; 44 is for touch.
            <RoundButton icon={ArrowLeft} label={t('nav.backToFeed')} size={44} href="#/" />
          )
        }
        logo={chosen && !closed ? '#/' : true}
        className={styles.header}
      />
      <div className={styles.content}>{content}</div>
      <Copyright />
      <CodeDialog
        key={inviting ? 'invite' : 'closed'}
        target={inviting ? null : undefined}
        onClose={() => setInviting(false)}
      />
    </main>
  )
}

export default ProfilePicker
