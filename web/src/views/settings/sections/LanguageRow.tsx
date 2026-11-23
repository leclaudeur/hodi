import { useTranslation } from 'react-i18next'
import { LANGUAGES, LANGUAGE_NAMES, useLanguage } from '../../../lib/i18n.ts'
import { updatePreferences } from '../../../lib/preferences.ts'
import Segmented from '../../../ui/Segmented.tsx'
import SettingRow from '../SettingRow.tsx'

// The interface's language, among a person's own settings (PersonalRows).
const LanguageRow = () => {
  const { t } = useTranslation()
  const language = useLanguage()
  return (
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
  )
}

export default LanguageRow
