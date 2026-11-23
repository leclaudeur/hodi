import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Button from '../../ui/Button.tsx'
import SettingRow from '../../views/settings/SettingRow.tsx'
import settingsStyles from '../../views/settings/Settings.module.css'
import { Actions, StepHeader } from '../SetupParts.tsx'
import styles from '../SetupPage.module.css'

interface ReadyStepProps {
  email: string
  onHousehold: () => void
}

// « Le serveur est prêt »: the server admin's own profile comes next.
const ReadyStep = ({ email, onHousehold }: ReadyStepProps) => {
  const { t } = useTranslation()
  return (
    <div className={styles.form}>
      <StepHeader title={t('setup.ready.title')} intro={t('setup.ready.intro')} />
      <div className={settingsStyles.card}>
        <SettingRow label={t('setup.done.account')} hint={t('setup.done.serverAdmin', { email })} />
      </div>
      <Actions>
        <Button look="primary" onClick={onHousehold}>
          {t('setup.ready.household')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </Actions>
    </div>
  )
}

export default ReadyStep
