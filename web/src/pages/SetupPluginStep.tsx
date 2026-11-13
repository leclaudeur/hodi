import { ArrowRight, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ServerMail as Mail, getServerMail } from '../api.ts'
import { useIsDesktop } from '../lib/use-media.ts'
import PluginSlot from '../plugins/PluginSlot.tsx'
import { SetupBackContext } from '../plugins/SetupActions.tsx'
import { type PluginInfo, type SetupStep, type SetupStepProps, pluginNamespace } from '../plugins/registry.ts'
import Button from '../ui/Button.tsx'
import StatusLine from '../ui/StatusLine.tsx'
import MailDialog from '../views/server/MailDialog.tsx'
import SettingRow from '../views/settings/SettingRow.tsx'
import settingsStyles from '../views/settings/Settings.module.css'
import { Actions, StepHeader } from './SetupParts.tsx'
import styles from './SetupPage.module.css'
import { pluginName } from '../plugins/plugin-texts.ts'

interface SetupPluginStepProps {
  plugin: PluginInfo
  step: SetupStep
  // Its place among the setup's numbered steps, and their number with the plugins' steps.
  index: number
  total: number
  onBack: () => void
  onNext: () => void
}

// One of a plugin's steps in the setup: Hodi draws the card's header, the plugin what is under it, ending with its
// SetupActions, whose « Retour » is this one's. A step whose code fails can be skipped: the plugin is set up later in
// the server's space.
const SetupPluginStep = ({ plugin, step, index, total, onBack, onNext }: SetupPluginStepProps) => {
  const { t, i18n } = useTranslation()
  const layout: SetupStepProps['layout'] = useIsDesktop() ? 'desktop' : 'phone'
  if ('core' in step) return <MailStep index={index} total={total} onBack={onBack} onNext={onNext} />

  const ns = pluginNamespace(plugin.id)
  const text = (key: string) => String(i18n.t(key as never, { ns } as never))
  return (
    <div className={styles.form}>
      <StepHeader step={index} total={total} title={text(step.title)} intro={text(step.intro)} />
      <SetupBackContext value={onBack}>
        <PluginSlot
          // A new step is a new page: what the previous one kept is gone.
          key={`${plugin.id}/${step.id}`}
          id={plugin.id}
          component={step.page}
          props={{ next: onNext, layout }}
          fallback={
            <>
              <StatusLine tone="error">{t('setup.pluginStep.failed', { name: pluginName(plugin) })}</StatusLine>
              <Actions onBack={onBack}>
                <Button look="primary" onClick={onNext}>
                  {t('common.continue')}
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </Actions>
            </>
          }
        />
      </SetupBackContext>
    </div>
  )
}

// `core: 'mail'`: Serveur › E-mail's form, which a plugin places among its steps instead of writing its own.
const MailStep = ({ index, total, onBack, onNext }: Omit<SetupPluginStepProps, 'plugin' | 'step'>) => {
  const { t } = useTranslation()
  const [mail, setMail] = useState<Mail | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    getServerMail()
      .then(setMail)
      .catch(() => setFailed(true))
  }, [])

  return (
    <div className={styles.form}>
      <StepHeader step={index} total={total} title={t('setup.mail.title')} intro={t('setup.mail.intro')} />
      {failed && <StatusLine tone="error">{t('server.mail.loadFailed')}</StatusLine>}
      {mail !== undefined && (
        <div className={settingsStyles.card}>
          <SettingRow
            label={t('server.mail.server')}
            value={mail ? mail.host : undefined}
            hint={mail ? undefined : t('server.mail.notSet')}
            action={{
              label: mail ? t('common.change') : t('server.mail.set'),
              icon: Pencil,
              onClick: () => setEditing(true)
            }}
          />
        </div>
      )}
      <Actions
        onBack={onBack}
        start={
          !mail && (
            <Button onClick={onNext} disabled={mail === undefined && !failed}>
              {t('setup.mail.later')}
            </Button>
          )
        }
      >
        <Button look="primary" disabled={!mail} onClick={onNext}>
          {t('common.continue')}
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </Actions>
      {editing && mail !== undefined && <MailDialog mail={mail} onClose={() => setEditing(false)} onSaved={setMail} />}
    </div>
  )
}

export default SetupPluginStep
