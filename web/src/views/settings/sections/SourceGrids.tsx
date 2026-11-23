import { Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SourceRequest } from '../../../api.ts'
import SourceCard from '../../../ui/SourceCard.tsx'
import cardStyles from '../../../ui/SourceCard.module.css'
import styles from './SourcesSection.module.css'

interface GridSectionProps {
  title: string
  count: number
  // Beside the title: « Tout retirer » while the little-read ones are filtered on.
  action?: ReactNode
  children: ReactNode
}

// A grid of source cards under its title and count.
export const GridSection = ({ title, count, action, children }: GridSectionProps) => (
  <section className={styles.gridSection}>
    <div className={styles.gridHead}>
      <h2 className={styles.gridTitle}>
        {title} <span className={styles.gridCount}>{count}</span>
      </h2>
      {action}
    </div>
    <ul className={cardStyles.grid}>{children}</ul>
  </section>
)

// A teen's requests, waiting for its parents: their cards, « En attente » in the corner.
export const RequestCards = ({ requests }: { requests: SourceRequest[] }) => {
  const { t } = useTranslation()
  return (
    <GridSection title={t('requests.mine')} count={requests.length}>
      {requests.map(request => (
        <SourceCard
          key={request.id}
          sourceId=""
          name={request.source.name}
          topic={null}
          moreTopics={0}
          corner={
            <span title={t('requests.pendingLabel')}>
              <Clock size={13} aria-hidden="true" /> {t('requests.pending')}
            </span>
          }
          actions={null}
        />
      ))}
    </GridSection>
  )
}
