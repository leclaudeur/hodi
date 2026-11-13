import { ArrowRight } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { SetupPlugin } from '../../api.ts'
import Button from '../../ui/Button.tsx'
import StatusLine from '../../ui/StatusLine.tsx'
import Toggle from '../../ui/Toggle.tsx'
import SettingRow from '../../views/settings/SettingRow.tsx'
import settingsStyles from '../../views/settings/Settings.module.css'
import { Actions, StepHeader } from '../SetupParts.tsx'
import styles from '../SetupPage.module.css'
import { pluginName, pluginDescription } from '../../plugins/plugin-texts.ts'

interface PluginsFoundStepProps {
  plugins: SetupPlugin[]
  on: Set<string>
  busy: boolean
  error: string | null
  onChange: (on: Set<string>) => void
  onContinue: () => void
}

const hintOf = (plugin: SetupPlugin, t: TFunction) => {
  if (plugin.error === 'outdated_api') return t('plugins.outdatedHint')
  if (plugin.error) return t('setup.plugins.broken')
  if (!plugin.signed) return t('setup.plugins.unsigned')
  return pluginDescription(plugin) ?? undefined
}

// « Plugins trouvés »: the plugins put in data/plugins before the first start, each turned on or off.
const PluginsFoundStep = ({ plugins, on, busy, error, onChange, onContinue }: PluginsFoundStepProps) => {
  const { t } = useTranslation()
  return (
    <div className={styles.form}>
      <StepHeader title={t('setup.plugins.title')} intro={t('setup.plugins.intro')} />
      <ul className={settingsStyles.card}>
        {plugins.map(plugin => (
          <SettingRow key={plugin.id} as="li" label={pluginName(plugin)} hint={hintOf(plugin, t)}>
            <Toggle
              label={t('setup.plugins.use', { name: pluginName(plugin) })}
              checked={plugin.error === null && on.has(plugin.id)}
              disabled={plugin.error !== null || busy}
              onChange={checked => {
                const next = new Set(on)
                if (checked) next.add(plugin.id)
                else next.delete(plugin.id)
                onChange(next)
              }}
            />
          </SettingRow>
        ))}
      </ul>
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <Actions>
        <Button look="primary" busy={busy} onClick={onContinue}>
          {t('common.continue')}
          {!busy && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
      </Actions>
    </div>
  )
}

export default PluginsFoundStep
