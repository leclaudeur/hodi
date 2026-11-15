import { Clock, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TopicItem } from '../api.ts'
import { articleHref } from '../lib/use-hash-route.ts'
import styles from './ReadPill.module.css'

interface ReadPillProps {
  item: TopicItem
  // 36 on a computer, 44 on a phone.
  size?: 34 | 44
  onOpen?: () => void
}

// "Lire" with the reading time: opens the article in Hodi, or its summary and the way to its site when it cannot
// be read here.
const ReadPill = ({ item, size = 34, onOpen }: ReadPillProps) => {
  const { t } = useTranslation()
  const isLink = item.access === 'link'

  return (
    <a className={`${styles.pill} ${styles[`size${size}`]}`} href={articleHref(item.id)} onClick={onOpen}>
      {t('stories.read')}
      {isLink ? (
        <span className={styles.chip}>
          <ExternalLink size={12} aria-hidden="true" />
          {t('stories.site')}
        </span>
      ) : (
        item.readingMinutes != null && (
          <span className={styles.chip}>
            <Clock size={12} aria-hidden="true" />
            {t('time.minutes', { count: item.readingMinutes })}
            <span className="visually-hidden"> {t('card.ofReading')}</span>
          </span>
        )
      )}
    </a>
  )
}

export default ReadPill
