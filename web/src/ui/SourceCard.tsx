import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import SourceAvatar from './SourceAvatar.tsx'
import styles from './SourceCard.module.css'

interface SourceCardProps {
  sourceId: string
  name: string
  // The theme shown: the one browsed or filtered on first, else its first; null for a channel without one.
  topic: { id: string; label: string } | null
  // Its other themes, as « +2 ».
  moreTopics: number
  // At the card's top corner: how many read it.
  corner?: ReactNode
  // On its logo: what is wrong with it (a feed that fails, a source little read).
  badge?: ReactNode
  // Already in Mes sources, in the catalogue: an accent border.
  picked?: boolean
  // Its footer, under a line across the card: the main action on the left, the others on the right.
  start: ReactNode
  end?: ReactNode
}

// A source as a card, in a grid: its logo in a round, its name, a theme and how many more, then a footer with its
// buttons, as a dialog's. The same card in Mes sources and in the Catalogue.
const SourceCard = ({
  sourceId,
  name,
  topic,
  moreTopics,
  corner,
  badge,
  picked = false,
  start,
  end
}: SourceCardProps) => {
  const { t } = useTranslation()
  return (
    <li className={picked ? `${styles.card} ${styles.picked}` : styles.card}>
      {corner && <span className={styles.corner}>{corner}</span>}
      <span className={styles.logo}>
        <SourceAvatar sourceId={sourceId} sourceName={name} size={44} />
        {badge}
      </span>
      <h3 className={styles.name} title={name}>
        {name}
      </h3>
      {topic && (
        <span className={styles.topics}>
          <span className={styles.topic} data-topic={topic.id}>
            {topic.label}
          </span>
          {moreTopics > 0 && (
            <span className={styles.more} title={t('sourceCard.moreTopics', { count: moreTopics })}>
              +{moreTopics}
            </span>
          )}
        </span>
      )}
      <span className={styles.footer}>
        <span className={styles.footerSide}>{start}</span>
        {end && <span className={styles.footerSide}>{end}</span>}
      </span>
    </li>
  )
}

export default SourceCard
