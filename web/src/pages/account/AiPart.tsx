import { KeyRound, MapPin, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AccountView, UnauthorizedError, changeAccountRegion, removeAccountAi } from '../../api.ts'
import { refreshAiUsage } from '../../lib/ai-left.ts'
import { askToConfirm } from '../../lib/confirm.ts'
import { useProfiles } from '../../lib/profiles.ts'
import { countryName } from '../../lib/regions.ts'
import { useAiUsage } from '../../lib/settings-data.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import RichText from '../../ui/RichText.tsx'
import SparkleIcon from '../../ui/SparkleIcon.tsx'
import { usePlugins } from '../../plugins/registry.ts'
import { CountryPicker } from '../../views/household/RegionPickers.tsx'
import SettingRow from '../../views/settings/SettingRow.tsx'
import styles from '../../views/settings/Settings.module.css'
import aiStyles from '../../views/settings/sections/AiSection.module.css'
import { AiKeyDialog, PluginRows, UsageRows } from '../../views/settings/sections/AiParts.tsx'

interface KeyCardProps {
  account: AccountView
  onAccount: (account: AccountView) => void
  onUnauthorized: () => void
}

const failed = (onUnauthorized: () => void, message: string) => (error: unknown) => {
  if (error instanceof UnauthorizedError) onUnauthorized()
  else showError(message)
}

// The account's own key, which pays for its violet buttons, and its country, for the AI's web searches.
const KeyCard = ({ account, onAccount, onUnauthorized }: KeyCardProps) => {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  // The buttons come or go with the key: the calls of the day are read again.
  const keyChanged = (next: AccountView) => {
    onAccount(next)
    void refreshAiUsage()
    showSaved(t(next.ai ? 'ai.on' : 'ai.removed'))
  }
  const removeKey = () =>
    askToConfirm({
      title: t('confirm.removeKey.title'),
      message: <RichText i18nKey="confirm.removeKey.message" />,
      label: t('confirm.removeKey.button'),
      onConfirm: () =>
        void removeAccountAi()
          .then(keyChanged)
          .catch(failed(onUnauthorized, t('ai.removeFailed')))
    })
  const saveCountry = (country: string | null) =>
    void changeAccountRegion({ country })
      .then(next => {
        onAccount(next)
        showSaved()
      })
      .catch(failed(onUnauthorized, t('ai.countryFailed')))
  return (
    <>
      <div className={styles.card}>
        {account.ai ? (
          <>
            <SettingRow label={account.ai.providerName} value={t('ai.model', { model: account.ai.model })} />
            <SettingRow
              label={t('ai.key')}
              value={account.ai.keyHint}
              action={[
                { label: t('ai.replace'), icon: KeyRound, onClick: () => setEditing(true) },
                { label: t('ai.remove'), look: 'danger', icon: Trash2, onClick: removeKey }
              ]}
            />
            <SettingRow
              label={t('regions.country')}
              value={account.country ? countryName(account.country) : t('common.none')}
              action={{ label: t('common.change'), icon: MapPin, onClick: () => setPicking(true) }}
            />
          </>
        ) : (
          <SettingRow
            label={t('ai.off')}
            hint={t('ai.offAdmin')}
            lead={
              <span className={aiStyles.mark}>
                <SparkleIcon size={18} />
              </span>
            }
            action={{ label: t('ai.addKey'), icon: KeyRound, onClick: () => setEditing(true) }}
          />
        )}
      </div>
      <CountryPicker open={picking} value={account.country} onPick={saveCountry} onClose={() => setPicking(false)} />
      {editing && (
        <AiKeyDialog
          account={account}
          onSaved={keyChanged}
          onClose={() => setEditing(false)}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  )
}

// The account's calls of the last 24 hours, kind by kind, then the plugins' (the server admin's).
const Usage = ({ onUnauthorized }: { onUnauthorized: () => void }) => {
  const { t } = useTranslation()
  const { value: usage } = useAiUsage(onUnauthorized)
  const household = useProfiles({ onError: () => {} })
  const admin = household?.serverAdmin === true
  // The plugins' kind only once a plugin of the household has a violet button.
  const pluginsAsk = usePlugins().plugins.some(plugin => plugin.enabled && !plugin.error && plugin.usesAi)
  if (!usage?.available) return null
  return (
    <>
      <h2 className={styles.label}>{t('ai.yours')}</h2>
      <UsageRows rows={usage.kinds.filter(row => pluginsAsk || row.kind !== 'plugin')} />
      {admin && pluginsAsk && <PluginRows onUnauthorized={onUnauthorized} />}
    </>
  )
}

interface AiPartProps extends KeyCardProps {
  // Calls are counted while reading in a household.
  inHousehold: boolean
}

// Mon compte › IA et crédits: the account's own key, then its calls of the last 24 hours.
const AiPart = ({ account, onAccount, onUnauthorized, inHousehold }: AiPartProps) => (
  <>
    <KeyCard account={account} onAccount={onAccount} onUnauthorized={onUnauthorized} />
    {/* Read again with each new key: the buttons come or go with it. */}
    {inHousehold && <Usage key={account.ai?.keyHint ?? 'none'} onUnauthorized={onUnauthorized} />}
  </>
)

export default AiPart
