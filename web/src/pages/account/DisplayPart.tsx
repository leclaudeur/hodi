import { Flower2, Moon, Sun } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { type Theme, updatePreferences, usePreferences } from '../../lib/preferences.ts'
import { shownTheme } from '../../lib/theme.ts'
import { TEXT_SCALES } from '../../lib/text-size.ts'
import { startUserStateSync } from '../../lib/user-state.ts'
import Segmented from '../../ui/Segmented.tsx'
import Toggle from '../../ui/Toggle.tsx'
import SettingRow from '../../views/settings/SettingRow.tsx'
import styles from '../../views/settings/Settings.module.css'

const THEMES: { value: Theme; icon: typeof Sun }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'powder', icon: Flower2 }
]

// Mon compte › Affichage: the theme, the text's size and the read articles, which follow the account to every device.
const DisplayPart = () => {
  const { t } = useTranslation()
  // Read from every device, and saved for them, as the feed does.
  useEffect(() => startUserStateSync(), [])
  const preferences = usePreferences()
  return (
    <div className={styles.card}>
      <SettingRow
        label={t('settings.reading.appearance')}
        hint={t('settings.reading.appearanceHint')}
        choice={
          <Segmented
            label={t('settings.reading.appearance')}
            value={shownTheme(preferences.theme)}
            onChange={theme => updatePreferences({ theme })}
            options={THEMES.map(({ value, icon: Icon }) => ({
              value,
              title: t(`settings.reading.themes.${value}`),
              label: (
                <>
                  <Icon size={14} aria-hidden="true" />
                  {t(`settings.reading.themes.${value}`)}
                </>
              )
            }))}
          />
        }
      />
      <SettingRow
        label={t('settings.reading.textSize')}
        hint={t('settings.reading.textSizeHint')}
        choice={
          <Segmented
            label={t('settings.reading.textSize')}
            value={Math.min(TEXT_SCALES.length - 1, Math.max(0, preferences.textSize))}
            onChange={textSize => updatePreferences({ textSize })}
            options={TEXT_SCALES.map((scale, index) => ({
              value: index,
              // "A" at each text size, growing like the text it gives.
              title: t('settings.reading.sizes', { returnObjects: true })[index] ?? `${Math.round(scale * 100)} %`,
              label: <span style={{ fontSize: Math.round(11 * scale + 2) }}>A</span>
            }))}
          />
        }
      />
      <SettingRow label={t('settings.reading.hideRead')} hint={t('settings.reading.hideReadHint')}>
        <Toggle
          label={t('settings.reading.hideRead')}
          checked={preferences.hideRead}
          onChange={hideRead => updatePreferences({ hideRead })}
        />
      </SettingRow>
    </div>
  )
}

export default DisplayPart
