import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './Chip.module.css'

// The reading time, a bordered capsule with a clock, everywhere an article shows.
const ReadingTime = ({ minutes }: { minutes: number }) => {
  const { t } = useTranslation()
  return (
    <span className={styles.chip}>
      <Clock size={12} aria-hidden="true" />
      {t('time.minutes', { count: minutes })}
      <span className="visually-hidden"> {t('card.ofReading')}</span>
    </span>
  )
}

export default ReadingTime
