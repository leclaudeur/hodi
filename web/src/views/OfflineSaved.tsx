import { useSaved } from '../lib/saved.ts'
import { useTranslation } from 'react-i18next'
import ArticleCard from '../ui/ArticleCard.tsx'
import DaySeparator from '../ui/DaySeparator.tsx'

// Under a list that failed to load on a phone: the saved articles whose text this device keeps, ready to read.
const OfflineSaved = () => {
  const { t } = useTranslation()
  const ready = useSaved().filter(entry => entry.article !== null)
  if (ready.length === 0) return null

  return (
    <section aria-label={t('feed.savedOfflineLabel')}>
      <DaySeparator label={t('nav.saved')} count={ready.length} first />
      {ready.map(({ item }) => (
        <ArticleCard key={item.id} item={item} variant="compact" offline />
      ))}
    </section>
  )
}

export default OfflineSaved
