import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Button from '../../ui/Button.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import SettingRow from '../../views/settings/SettingRow.tsx'
import settingsStyles from '../../views/settings/Settings.module.css'
import { Actions, StepHeader } from '../SetupParts.tsx'
import styles from '../SetupPage.module.css'

interface ReadyStepProps {
  email: string
  busy: boolean
  error: string | null
  onLater: () => void
  onHousehold: () => void
}

// « Le serveur est prêt »: the household now, or the server's space first.
const ReadyStep = ({ email, busy, error, onLater, onHousehold }: ReadyStepProps) => {
  const { t } = useTranslation()
  return (
    <div className={styles.form}>
      <StepHeader title={t('setup.ready.title')} intro={t('setup.ready.intro')} />
      <div className={settingsStyles.card}>
        <SettingRow label={t('setup.done.account')} hint={t('setup.done.serverAdmin', { email })} />
      </div>
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <Actions
        start={
          <Button busy={busy} onClick={onLater}>
            {t('setup.ready.server')}
          </Button>
        }
      >
        <Button look="primary" onClick={onHousehold}>
          {t('setup.ready.household')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </Actions>
    </div>
  )
}

export default ReadyStep
