import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Household, updateHousehold } from '../../api.ts'
import { type HourCycle, setHourCycle } from '../../lib/format.ts'
import { switchGame, useGameEnabled } from '../../lib/game.ts'
import { LANGUAGES, LANGUAGE_NAMES, type Language, setHouseholdLanguage } from '../../lib/i18n.ts'
import { useHousehold } from '../../lib/settings-data.ts'
import { showError, showSaved } from '../../lib/toast.ts'
import Segmented from '../../ui/Segmented.tsx'
import Toggle from '../../ui/Toggle.tsx'
import SettingRow from '../settings/SettingRow.tsx'
import styles from '../settings/Settings.module.css'
import ServerData from '../settings/sections/ServerData.tsx'

// The language and the time format, saved at once: for the sign-in screen and every account that chose none.
const useDefaultsSaving = (replace: (next: Household) => void) => {
  const { t } = useTranslation()
  const saved = (next: Household) => {
    replace(next)
    showSaved()
  }
  const failed = () => showError(t('server.general.defaultsFailed'))
  const saveHourCycle = (hourCycle: HourCycle) => {
    setHourCycle(hourCycle)
    updateHousehold({ hourCycle }).then(saved).catch(failed)
  }
  const saveLanguage = (language: Language) =>
    updateHousehold({ language })
      .then(next => {
        saved(next)
        setHouseholdLanguage(next.language)
      })
      .catch(failed)
  return { saveHourCycle, saveLanguage }
}

const DefaultChoices = ({ household, replace }: { household: Household; replace: (next: Household) => void }) => {
  const { t } = useTranslation()
  const { saveHourCycle, saveLanguage } = useDefaultsSaving(replace)
  return (
    <>
      <SettingRow
        label={t('language.householdLabel')}
        hint={t('language.householdHint')}
        choice={
          <Segmented
            label={t('language.householdLabel')}
            value={household.language}
            onChange={saveLanguage}
            options={LANGUAGES.map(option => ({
              value: option,
              title: LANGUAGE_NAMES[option],
              label: LANGUAGE_NAMES[option]
            }))}
          />
        }
      />
      <SettingRow
        label={t('hourCycle.label')}
        hint={t('hourCycle.hint')}
        choice={
          <Segmented
            label={t('hourCycle.label')}
            value={household.hourCycle}
            onChange={saveHourCycle}
            options={([24, 12] as const).map(option => ({
              value: option,
              title: t(`hourCycle.example${option}`),
              label: t(`hourCycle.option${option}`)
            }))}
          />
        }
      />
    </>
  )
}

// The game, on or off for everyone.
const GameRow = ({ enabled }: { enabled: boolean }) => {
  const { t } = useTranslation()
  const [switching, setSwitching] = useState(false)
  return (
    <SettingRow label={t('settings.household.gameToggle')} hint={t('settings.household.gameHint')}>
      <Toggle
        checked={enabled}
        label={t('settings.household.gameToggle')}
        disabled={switching}
        onChange={next => {
          setSwitching(true)
          switchGame(next)
            .then(() => showSaved(t(next ? 'settings.household.gameOn' : 'settings.household.gameOff')))
            .catch(() => showError(t('settings.household.gameFailed')))
            .finally(() => setSwitching(false))
        }}
      />
    </SettingRow>
  )
}

// Serveur › Général, under the addresses: what holds for every account, then what the server keeps.
const ServerDefaults = () => {
  const { t } = useTranslation()
  const { value: household, replace } = useHousehold()
  const gameEnabled = useGameEnabled()
  if (!household) return null
  return (
    <>
      <h2 className={styles.label}>{t('server.general.everyone')}</h2>
      <div className={styles.card}>
        <DefaultChoices household={household} replace={replace} />
        {gameEnabled !== null && <GameRow enabled={gameEnabled} />}
      </div>
      <ServerData />
    </>
  )
}

export default ServerDefaults
