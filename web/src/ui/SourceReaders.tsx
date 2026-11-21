import { useTranslation } from 'react-i18next'
import { readersCount } from '../lib/catalogue.ts'
import { getLanguage } from '../lib/i18n.ts'

// A card's corner: how many read the source, in words, once there are enough of them to say (source-view-routes.ts).
const SourceReaders = ({ readers }: { readers: number | undefined }) => {
  const { t } = useTranslation()
  if (readers === undefined) return null
  const formatted = readersCount(readers, getLanguage())
  return <span>{t('sources.readers', { count: readers, formatted })}</span>
}

export default SourceReaders
