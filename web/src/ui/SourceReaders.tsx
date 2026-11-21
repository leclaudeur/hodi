import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readersCount } from '../lib/catalogue.ts'
import { getLanguage } from '../lib/i18n.ts'

// A card's corner: how many read the source, once there are enough of them to say (source-view-routes.ts).
const SourceReaders = ({ readers }: { readers: number | undefined }) => {
  const { t } = useTranslation()
  if (readers === undefined) return null
  const formatted = readersCount(readers, getLanguage())
  return (
    <span title={t('sources.readers', { count: readers, formatted })}>
      <Users size={13} aria-hidden="true" /> {formatted}
    </span>
  )
}

export default SourceReaders
