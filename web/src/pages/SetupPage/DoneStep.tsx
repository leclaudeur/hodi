import { ArrowRight, Clock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AiProviderInfo } from '../../api.ts'
import { timeZoneOffset } from '../../lib/regions.ts'
import Button from '../../ui/Button.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import { TimeZonePicker } from '../../views/household/RegionPickers.tsx'
import SettingRow from '../../views/settings/SettingRow.tsx'
import settingsStyles from '../../views/settings/Settings.module.css'
import { Actions, StepHeader } from '../SetupParts.tsx'
import styles from '../SetupPage.module.css'

interface DoneStepProps {
  step: number
  total: number
  timeZone: string
  onTimeZone: (timeZone: string) => void
  email: string
  household: string
  profile: string
  provider: AiProviderInfo | null
  busy: boolean
  error: string | null
  onFinish: () => void
  onBack: () => void
}

// The recap, with the time zone, before the household reaches the server.
const DoneStep = (props: DoneStepProps) => {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const { provider } = props
  return (
    <div className={styles.form}>
      <StepHeader step={props.step} total={props.total} title={t('setup.done.title')} intro={t('setup.done.intro')} />
      <div className={settingsStyles.card}>
        <SettingRow
          label={t('regions.timeZone')}
          value={`${props.timeZone} · ${timeZoneOffset(props.timeZone)}`}
          action={{ label: t('common.change'), icon: Clock, onClick: () => setPicking(true) }}
        />
        <SettingRow label={t('setup.done.account')} hint={t('setup.done.serverAdmin', { email: props.email })} />
        <SettingRow
          label={t('setup.done.household')}
          hint={t('setup.done.admin', { household: props.household, profile: props.profile })}
        />
        <SettingRow
          label={t('setup.done.ai')}
          hint={provider ? t('setup.done.keyChecked', { provider: provider.name }) : t('setup.ai.none')}
        />
      </div>
      {props.error && <StatusLine tone="error">{props.error}</StatusLine>}
      <Actions onBack={props.onBack}>
        <Button look="primary" busy={props.busy} onClick={props.onFinish}>
          {t('setup.done.enter')}
          {!props.busy && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
      </Actions>
      <TimeZonePicker
        open={picking}
        value={props.timeZone}
        onPick={props.onTimeZone}
        onClose={() => setPicking(false)}
      />
    </div>
  )
}

export default DoneStep
