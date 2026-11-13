import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ProfileForm, { type ProfileDraft } from '../../views/profiles/ProfileForm.tsx'
import { StepHeader } from '../SetupParts.tsx'
import styles from '../SetupPage.module.css'

interface ProfileStepProps {
  step: number
  total: number
  profile: ProfileDraft | null
  onBack: () => void
  onSave: (next: ProfileDraft) => Promise<void>
}

// The household admin's profile.
const ProfileStep = ({ step, total, profile, onBack, onSave }: ProfileStepProps) => {
  const { t } = useTranslation()
  return (
    <div className={styles.form}>
      <StepHeader step={step} total={total} title={t('setup.profile.title')} intro={t('setup.profile.intro')} />
      <ProfileForm
        initial={profile ?? undefined}
        className={styles.profileForm}
        submitLabel={
          <>
            {t('common.continue')}
            <ArrowRight size={16} aria-hidden="true" />
          </>
        }
        cancelLabel={
          <>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('common.back')}
          </>
        }
        onCancel={onBack}
        onSave={onSave}
      />
    </div>
  )
}

export default ProfileStep
