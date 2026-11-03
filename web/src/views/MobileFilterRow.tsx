import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TopicSummary } from '../api.ts'
import { FRONT_PAGE_HREF, topicHref } from '../lib/use-hash-route.ts'
import FilterChip from '../ui/FilterChip.tsx'
import TopicCapsule from '../ui/TopicCapsule.tsx'
import styles from './MobileFilterRow.module.css'

interface MobileFilterRowProps {
  topics: TopicSummary[]
  // The topic shown, or null for "Tout".
  selected: string | null
}

// "TOUT" and each topic, under the stories on a phone. The open topic comes right after "TOUT".
const MobileFilterRow = ({ topics, selected }: MobileFilterRowProps) => {
  const { t } = useTranslation()
  const row = useRef<HTMLElement>(null)
  const current = topics.find(topic => topic.id === selected)
  const shown = current ? [current, ...topics.filter(topic => topic !== current)] : topics

  useEffect(() => {
    row.current?.scrollTo({ left: 0 })
  }, [selected])

  return (
    <nav ref={row} className={`${styles.row} no-scrollbar edge-fade`} aria-label={t('nav.topics')}>
      <FilterChip selected={selected === null} href={FRONT_PAGE_HREF}>
        {t('feed.allTopics')}
      </FilterChip>
      {shown.map(topic => (
        <TopicCapsule
          key={topic.id}
          topicId={topic.id}
          label={topic.label}
          href={topicHref(topic.id)}
          size="filter"
          selected={topic.id === selected}
        />
      ))}
    </nav>
  )
}

export default MobileFilterRow
