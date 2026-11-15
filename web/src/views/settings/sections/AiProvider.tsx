import { KeyRound, MapPin, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  type AiUsage,
  type Household,
  UnauthorizedError,
  getAiUsage,
  removeHouseholdAi,
  updateHousehold
} from '../../../api.ts'
import { refreshAiUsage } from '../../../lib/ai-left.ts'
import { askToConfirm } from '../../../lib/confirm.ts'
import { countryName } from '../../../lib/regions.ts'
import { showError, showSaved } from '../../../lib/toast.ts'
import SparkleIcon from '../../../ui/SparkleIcon.tsx'
import { CountryPicker } from '../../household/RegionPickers.tsx'
import RichText from '../../../ui/RichText.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'
import aiStyles from './AiSection.module.css'
import { AiKeyDialog } from './AiParts.tsx'

// The admin's key and country: saved, replaced or removed.
export const useProviderActions = (
  replaceHousehold: (next: Household) => void,
  replace: (next: AiUsage) => void,
  onUnauthorized: () => void
) => {
  const { t } = useTranslation()
  // Only the AI's web searches use it, so it lives beside the key.
  const saveCountry = (country: string | null) =>
    void updateHousehold({ country })
      .then(next => {
        replaceHousehold(next)
        showSaved()
      })
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) onUnauthorized()
        else showError(t('ai.countryFailed'))
      })

  // The buttons come or go with the key: the calls of the day are read again.
  const keyChanged = (next: Household) => {
    replaceHousehold(next)
    void getAiUsage()
      .then(replace)
      .catch(() => {})
    void refreshAiUsage()
    showSaved(t(next.ai ? 'ai.on' : 'ai.removed'))
  }

  const removeKey = () =>
    askToConfirm({
      title: t('confirm.removeKey.title'),
      message: <RichText i18nKey="confirm.removeKey.message" />,
      label: t('confirm.removeKey.button'),
      onConfirm: () =>
        void removeHouseholdAi()
          .then(keyChanged)
          .catch((error: unknown) => {
            if (error instanceof UnauthorizedError) onUnauthorized()
            else showError(t('ai.removeFailed'))
          })
    })
  return { saveCountry, keyChanged, removeKey }
}

interface ProviderProps {
  household: Household
  editingKey: boolean
  onEditingKey: (editing: boolean) => void
  pickingCountry: boolean
  onPickingCountry: (picking: boolean) => void
  onCountry: (country: string | null) => void
  onKeyChanged: (next: Household) => void
  onRemoveKey: () => void
  onUnauthorized: () => void
}

// The admin's: who answers and with which key.
export const ProviderCard = (props: ProviderProps) => {
  const { t } = useTranslation()
  const { household, editingKey, onEditingKey, pickingCountry, onPickingCountry, onCountry, onKeyChanged } = props
  const { onRemoveKey, onUnauthorized } = props
  return (
    <>
      <h2 className={styles.label}>{t('ai.provider')}</h2>
      <div className={styles.card}>
        {household.ai ? (
          <>
            <SettingRow label={household.ai.providerName} value={t('ai.model', { model: household.ai.model })} />
            <SettingRow
              label={t('ai.key')}
              value={household.ai.keyHint}
              action={[
                { label: t('ai.replace'), icon: KeyRound, onClick: () => onEditingKey(true) },
                { label: t('ai.remove'), look: 'danger', icon: Trash2, onClick: onRemoveKey }
              ]}
            />
            <SettingRow
              label={t('regions.country')}
              value={household.country ? countryName(household.country) : t('common.none')}
              action={{ label: t('common.change'), icon: MapPin, onClick: () => onPickingCountry(true) }}
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
            action={{ label: t('ai.addKey'), icon: KeyRound, onClick: () => onEditingKey(true) }}
          />
        )}
      </div>
      <CountryPicker
        open={pickingCountry}
        value={household.country}
        onPick={onCountry}
        onClose={() => onPickingCountry(false)}
      />
      {editingKey && (
        <AiKeyDialog
          household={household}
          onSaved={onKeyChanged}
          onClose={() => onEditingKey(false)}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  )
}
