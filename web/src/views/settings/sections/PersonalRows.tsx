import { useTranslation } from 'react-i18next'
import { useHourCycle } from '../../../lib/format.ts'
import { useGameEnabled } from '../../../lib/game.ts'
import { updatePreferences } from '../../../lib/preferences.ts'
import Segmented from '../../../ui/Segmented.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SettingRow from '../SettingRow.tsx'
import LanguageRow from './LanguageRow.tsx'

// The time of day as this person reads it, on every device.
const HourCycleRow = () => {
  const { t } = useTranslation()
  const hourCycle = useHourCycle()
  return (
    <SettingRow
      label={t('hourCycle.label')}
      hint={t('hourCycle.hint')}
      choice={
        <Segmented
          label={t('hourCycle.label')}
          value={hourCycle}
          onChange={next => updatePreferences({ hourCycle: next })}
          options={([24, 12] as const).map(option => ({
            value: option,
            title: t(`hourCycle.example${option}`),
            label: t(`hourCycle.option${option}`)
          }))}
        />
      }
    />
  )
}

// Levels and badges on the avatars, for this person only: the points still count, shown again when it is back on.
const GameRow = () => {
  const { t } = useTranslation()
  const enabled = useGameEnabled()
  if (enabled === null) return null
  return (
    <SettingRow label={t('settings.household.gameToggle')} hint={t('settings.household.gameHint')}>
      <Toggle
        checked={enabled}
        label={t('settings.household.gameToggle')}
        onChange={next => updatePreferences({ game: next })}
      />
    </SettingRow>
  )
}

// A person's own way of reading the app: its language, its time format, its game. An adult's in Mon compte › Profil;
// a young one's, which has no Mon compte, in Réglages › Général.
const PersonalRows = () => (
  <>
    <LanguageRow />
    <HourCycleRow />
    <GameRow />
  </>
)

export default PersonalRows
