import { useTranslation } from 'react-i18next'
import { type Language, useLanguage } from '../lib/i18n.ts'
import Chip from './Chip.tsx'

// The two-letter code of a source's language ("EN", "FR"), only when it isn't the interface's: an English source
// says nothing to someone who reads Hodi in English.
const LanguageChip = ({ lang, size }: { lang: Language; size?: 'capsule' }) => {
  const { t } = useTranslation()
  const interfaceLanguage = useLanguage()
  if (lang === interfaceLanguage) return null
  return (
    <Chip label={t(`language.in.${lang}`)} size={size}>
      {lang.toUpperCase()}
    </Chip>
  )
}

export default LanguageChip
