import { useTranslation } from 'react-i18next'
import type { ServerOverview } from '../../../api.ts'
import Chip from '../../../ui/Chip.tsx'
import { Keys } from './Donut.tsx'
import { spanText } from './metrics.ts'
import styles from './OverviewCards.module.css'
import board from './Overview.module.css'

// Every profile on the server, adults against teens and children, and how many the period added.
const ProfilesCard = ({
  profiles,
  added,
  span
}: {
  profiles: ServerOverview['profiles']
  added: number
  span: number
}) => {
  const { t } = useTranslation()
  const { adults, young } = profiles
  const parts = [
    { key: 'adults', name: t('server.overview.adults'), value: adults, colour: 'var(--rust)' },
    { key: 'young', name: t('server.overview.young'), value: young, colour: 'var(--topic-film-tv)' }
  ]
  return (
    <section className={board.card} aria-labelledby="overview-profiles">
      <div className={board.cardHead}>
        <h2 id="overview-profiles" className={board.cardTitle}>
          {t('server.overview.profiles', { count: adults + young })}
          <span className={board.count}>{adults + young}</span>
        </h2>
        {added > 0 && (
          <Chip tone="success">
            {span
              ? t('server.overview.added', { count: added, span: spanText(t, span) })
              : t('server.overview.addedAll', { count: added })}
          </Chip>
        )}
      </div>
      <div className={styles.split}>
        <span className={styles.splitBar} aria-hidden="true">
          {parts.map(part => (
            <span key={part.key} style={{ flex: part.value, background: part.colour }} />
          ))}
        </span>
        <Keys parts={parts} />
      </div>
    </section>
  )
}

export default ProfilesCard
