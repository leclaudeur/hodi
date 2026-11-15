import { Flower2, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, LANGUAGE_NAMES, useLanguage } from '../../../lib/i18n.ts'
import { ACCENT_COLORS, type Accent, type Theme, updatePreferences, usePreferences } from '../../../lib/preferences.ts'
import { shownTheme } from '../../../lib/theme.ts'
import { TEXT_SCALES } from '../../../lib/text-size.ts'
import ColorSwatches from '../../../ui/ColorSwatches.tsx'
import Segmented from '../../../ui/Segmented.tsx'
import Toggle from '../../../ui/Toggle.tsx'
import SectionPage from '../SectionPage.tsx'
import SettingRow from '../SettingRow.tsx'
import styles from '../Settings.module.css'

const THEMES: { value: Theme; icon: typeof Sun }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'powder', icon: Flower2 }
]

// The theme's own colour first (rust, or Poudré's pink), then the topics' that read well as a brand.
const AccentRow = ({
  theme,
  accent,
  layout
}: {
  theme: ReturnType<typeof shownTheme>
  accent: Accent
  layout: 'desktop' | 'phone'
}) => {
  const { t } = useTranslation()
  return (
    <SettingRow
      label={t('settings.reading.accent')}
      hint={t('settings.reading.accentHint')}
      className={layout === 'phone' ? styles.stackedRow : undefined}
    >
      <ColorSwatches
        label={t('settings.reading.accent')}
        value={accent}
        size="small"
        row={layout === 'phone'}
        options={[
          {
            value: 'auto',
            name: t(theme === 'powder' ? 'settings.reading.accents.autoPowder' : 'settings.reading.accents.auto'),
            color: theme === 'powder' ? '#d98fa6' : '#c8693a'
          },
          // Five of the profile colours, under the names the profile form gives them.
          ...ACCENT_COLORS.map(color => ({
            value: color,
            name: t(`profileForm.colors.${color}`),
            color: `var(--topic-${color})`
          }))
        ]}
        onChange={accent => updatePreferences({ accent })}
      />
    </SettingRow>
  )
}

const ReadingSection = ({ layout }: { layout: 'desktop' | 'phone' }) => {
  const { t } = useTranslation()
  const preferences = usePreferences()
  const theme = shownTheme(preferences.theme)
  const language = useLanguage()

  return (
    <SectionPage title={t('settings.nav.reading')} intro={t('settings.reading.intro')} layout={layout}>
      <div className={styles.card}>
        <SettingRow
          label={t('language.label')}
          hint={t('language.profileHint')}
          choice={
            <Segmented
              label={t('language.label')}
              value={language}
              onChange={language => updatePreferences({ language })}
              options={LANGUAGES.map(option => ({
                value: option,
                title: LANGUAGE_NAMES[option],
                label: LANGUAGE_NAMES[option]
              }))}
            />
          }
        />
        <SettingRow
          label={t('settings.reading.appearance')}
          hint={t('settings.reading.appearanceHint')}
          choice={
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
                    {t(`settings.reading.themes.${value}`)}
                  </>
                )
              }))}
            />
          }
        />
        <AccentRow theme={theme} accent={preferences.accent} layout={layout} />
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
    </SectionPage>
  )
}

export default ReadingSection
