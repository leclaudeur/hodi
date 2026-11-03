import { ChevronRight, Flower2, Moon, Sun } from 'lucide-react'
import { PROFILE_COLORS } from '../../../api.ts'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, LANGUAGE_NAMES, useLanguage } from '../../../lib/i18n.ts'
import { type Theme, updatePreferences, usePreferences } from '../../../lib/preferences.ts'
import { shownTheme } from '../../../lib/theme.ts'
import { TEXT_SCALES } from '../../../lib/text-size.ts'
import { HISTORY_HREF } from '../../../lib/use-hash-route.ts'
import ColorSwatches from '../../../ui/ColorSwatches.tsx'
import Segmented from '../../../ui/Segmented.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SectionPage from '../SectionPage.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'

const THEMES: { value: Theme; icon: typeof Sun }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'poudre', icon: Flower2 }
]

// The theme's own colour first (rust, or Poudré's pink), then the topics' that read well as a brand.

const ReadingSection = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const theme = shownTheme(preferences.theme)
  const language = useLanguage()

  return (
    <SectionPage title={t('settings.nav.reading')} intro={t('settings.reading.intro')} layout={layout}>
      <div className={styles.card}>
        <SettingRow label={t('language.label')} hint={t('language.profileHint')}>
          <Segmented
            label={t('language.label')}
            value={language}
            onChange={language => updatePreferences({ language })}
            options={LANGUAGES.map(option => ({
              value: option,
              title: LANGUAGE_NAMES[option],
              label: layout === 'desktop' ? LANGUAGE_NAMES[option] : option.toUpperCase()
            }))}
          />
        </SettingRow>
        <SettingRow label={t('settings.reading.appearance')} hint={t('settings.reading.appearanceHint')}>
          <Segmented
            label={t('settings.reading.appearance')}
            value={theme}
            onChange={theme => updatePreferences({ theme })}
            options={THEMES.map(({ value, icon: Icon }) => ({
              value,
              title: t(`settings.reading.themes.${value}`),
              label: (
                <>
                  <Icon size={14} aria-hidden="true" />
                  {layout === 'desktop' && t(`settings.reading.themes.${value}`)}
                </>
              )
            }))}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.reading.accent')}
          hint={t('settings.reading.accentHint')}
          className={layout === 'phone' ? styles.stackedRow : undefined}
        >
          <ColorSwatches
            label={t('settings.reading.accent')}
            value={preferences.accent}
            size="small"
            row={layout === 'phone'}
            options={[
              {
                value: 'auto',
                name: t(theme === 'poudre' ? 'settings.reading.accents.autoPoudre' : 'settings.reading.accents.auto'),
                color: theme === 'poudre' ? '#d98fa6' : '#c8693a'
              },
              // The profile colours, under the names the profile form gives them.
              ...PROFILE_COLORS.map(color => ({
                value: color,
                name: t(`profileForm.colors.${color}`),
                color: `var(--topic-${color})`
              }))
            ]}
            onChange={accent => updatePreferences({ accent })}
          />
        </SettingRow>
        <SettingRow label={t('settings.reading.textSize')} hint={t('settings.reading.textSizeHint')}>
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
        </SettingRow>
        <SettingRow label={t('settings.reading.hideRead')} hint={t('settings.reading.hideReadHint')}>
          <Toggle
            label={t('settings.reading.hideRead')}
            checked={preferences.hideRead}
            onChange={hideRead => updatePreferences({ hideRead })}
          />
        </SettingRow>
        <a className={`${styles.row} ${styles.rowLink}`} href={HISTORY_HREF}>
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>{t('settings.reading.history')}</span>
            <span className={styles.rowHint}>{t('settings.reading.historyHint')}</span>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </a>
      </div>
    </SectionPage>
  )
}

export default ReadingSection
