import { RotateCcw } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AiKind,
  type AiPlugin,
  type Household,
  type KeyCheck,
  UnauthorizedError,
  checkAiKey,
  getAiPlugins,
  setAiPluginOn,
  setHouseholdAi
} from '../../../api.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import Button from '../../../ui/Button.tsx'
import Dialog from '../../../ui/Dialog.tsx'
import DialogActions from '../../../ui/DialogActions.tsx'
import RoundButton from '../../../ui/RoundButton.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import AiKeyField from '../../household/AiKeyField.tsx'
import householdStyles from '../../household/Household.module.css'
import RichText from '../../../ui/RichText.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import aiStyles from './AiSection.module.css'
import { pluginName } from '../../../plugins/plugin-texts.ts'

interface UsageRow {
  kind: AiKind
  used: number
  limit: number
}

// One kind's calls against its cap; the admin's red round puts it back to 0. Flat: the rows straight in an
// accordion, one line between each, no card in the card.
export const UsageRows = ({
  rows,
  onReset,
  flat = false
}: {
  rows: UsageRow[]
  onReset?: (kind: AiKind) => void
  flat?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <ul className={flat ? aiStyles.flat : styles.card}>
      {rows.map(({ kind, used, limit }) => (
        <li key={kind} className={styles.row}>
          <span className={styles.rowText}>
            {/* Each title names the button that spends the call, so no line under it is needed. */}
            <span className={styles.rowLabel}>{t(`ai.kinds.${kind}`)}</span>
            <span className={aiStyles.track} aria-hidden="true">
              <span
                className={aiStyles.fill}
                style={{ width: `${limit > 0 ? Math.min(100, (used / limit) * 100) : 0}%` }}
              />
            </span>
          </span>
          <span className={aiStyles.count}>
            <strong>{used}</strong> / {limit}
          </span>
          {onReset && (
            <RoundButton
              icon={RotateCcw}
              label={t('ai.resetKindLabel', { kind: t(`ai.kinds.${kind}`) })}
              size={38}
              disabled={used === 0}
              onClick={() => onReset(kind)}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

// The admin's « Plugins »: each plugin whose violet button may ask the household's AI, its calls of the last 24
// hours, and a switch that turns its AI off for the household (its button then says so).
export const PluginRows = ({ onUnauthorized }: { onUnauthorized: () => void }) => {
  const { t } = useTranslation()
  const [plugins, setPlugins] = useState<AiPlugin[] | null>(null)

  useEffect(() => {
    let current = true
    getAiPlugins()
      .then(next => {
        if (current) setPlugins(next)
      })
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
      })
    return () => {
      current = false
    }
  }, [onUnauthorized])

  const turn = (plugin: AiPlugin, on: boolean) =>
    void setAiPluginOn(plugin.id, on)
      .then(next => {
        setPlugins(next)
        showSaved()
      })
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
        else showError(t('ai.plugins.failed'))
      })

  if (!plugins || plugins.length === 0) return null
  return (
    <>
      <h2 className={styles.label}>{t('ai.plugins.title')}</h2>
      <ul className={styles.card}>
        {plugins.map(plugin => (
          <SettingRow
            key={plugin.id}
            as="li"
            label={pluginName(plugin)}
            hint={t('ai.plugins.calls', { count: plugin.calls })}
          >
            <Toggle
              label={t('ai.plugins.toggle', { name: pluginName(plugin) })}
              checked={plugin.on}
              onChange={on => turn(plugin, on)}
            />
          </SettingRow>
        ))}
      </ul>
    </>
  )
}

// A new key, checked on "Vérifier" (no credits spent), kept only once its provider took it.
export const AiKeyDialog = ({
  household,
  onSaved,
  onClose,
  onUnauthorized
}: {
  household: Household
  onSaved: (next: Household) => void
  onClose: () => void
  onUnauthorized: () => void
}) => {
  const { t } = useTranslation()
  const provider =
    household.providers.find(candidate => candidate.id === household.ai?.provider) ?? household.providers[0]
  const [key, setKey] = useState('')
  const [result, setResult] = useState<KeyCheck | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!provider) return
    setSaving(true)
    setFailed(false)
    try {
      onSaved(await setHouseholdAi(provider.id, key.trim()))
      onClose()
    } catch (error) {
      if (error instanceof UnauthorizedError) onUnauthorized()
      else setFailed(true)
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(household.ai ? 'ai.replaceKey' : 'ai.turnOn')}
      intro={<RichText i18nKey={household.ai ? 'dialogIntro.aiReplace' : 'dialogIntro.aiTurnOn'} />}
    >
      <form className={householdStyles.form} onSubmit={submit}>
        {provider && (
          <AiKeyField
            provider={provider}
            value={key}
            onChange={setKey}
            result={result}
            onResult={setResult}
            check={checkAiKey}
            onUnauthorized={onUnauthorized}
          />
        )}
        {failed && <StatusLine tone="error">{t('ai.keyFailed')}</StatusLine>}
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" look="primary" busy={saving} disabled={result !== 'ok'}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
