import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FrontPageSection, TopicItem } from '../api.ts'
import { useArticleImage } from '../lib/article-image.ts'
import {
  dailySummaryStoryId,
  refreshDailySummary,
  useDailySummaryWriting,
  useDailySummary,
  requestDailySummary
} from '../lib/daily-summary.ts'
import { orderTopics, usePreferences } from '../lib/preferences.ts'
import { isRead, useReadState } from '../lib/read-state.ts'
import { isStorySeen, useSeenStories } from '../lib/seen-stories.ts'
import { DAILY_SUMMARY_HREF, storyHref } from '../lib/use-hash-route.ts'
import { Bar } from '../ui/Skeleton.tsx'
import SparkleIcon from '../ui/SparkleIcon.tsx'
import styles from './StoriesRow.module.css'

// Short names under the squares: "JEUX", "FILMS".
const shortLabel = (label: string) => label.split(/[\s/&]+/)[0]?.toUpperCase() ?? label

interface StoriesRowProps {
  sections: FrontPageSection[]
  layout: 'desktop' | 'phone'
}

// A topic's first picture in its circle. A picture that doesn't load leaves the topic's plain round, not a broken
// image.
const Face = ({ item }: { item: TopicItem }) => {
  const image = useArticleImage(item.id, item.image, '64px')
  return image && <img {...image} alt="" loading="lazy" decoding="async" />
}

// A topic's stories are seen once each was shown in the viewer, or its article read.
export const isSectionSeen = (section: FrontPageSection) =>
  section.items.every(item => isStorySeen(item.id) || isRead(item.id))

// "À la une" as stories: one circle per topic, ringed in its colour until its stories are seen, after the
// "Résumé du jour"'s violet one.
const StoriesRow = ({ sections, layout }: StoriesRowProps) => {
  const { t } = useTranslation()
  useReadState()
  useSeenStories()
  const dailySummary = useDailySummary()
  const writing = useDailySummaryWriting()
  const preferences = usePreferences()
  const row = useRef<HTMLDivElement>(null)
  // Where the row was scrolled to: a topic seen moves to the end, the row stays where it was.
  const scrollLeft = useRef(0)
  // More circles on the right: the fade shows only then, never over the last one.
  const [more, setMore] = useState(false)
  const measure = (element: HTMLDivElement) =>
    setMore(element.scrollLeft + element.clientWidth < element.scrollWidth - 1)
  const shown = orderTopics(
    sections.filter(section => section.items.length > 0),
    preferences
  )
  // Unread topics first, as on a phone's stories.
  const sorted = [...shown].sort((a, b) => Number(isSectionSeen(a)) - Number(isSectionSeen(b)))
  const order = sorted.map(section => section.id).join(' ')

  // Reading the last daily summary is free: asked on each visit, another device may have written one since.
  useEffect(() => {
    refreshDailySummary().catch(() => {})
  }, [])

  useLayoutEffect(() => {
    if (row.current) row.current.scrollLeft = scrollLeft.current
  }, [order])

  useEffect(() => {
    const element = row.current
    if (!element) return
    measure(element)
    const observer = new ResizeObserver(() => measure(element))
    observer.observe(element)
    return () => observer.disconnect()
  }, [order])

  if (shown.length === 0) return null
  const dailySummarySeen = dailySummary?.status === 'ok' && isStorySeen(dailySummaryStoryId(dailySummary.generatedAt))

  return (
    <div className={`${styles.wrap} ${styles[layout]} ${more ? styles.more : ''} appear`}>
      <div
        ref={row}
        className={`${styles.row} no-scrollbar edge-fade`}
        onScroll={event => {
          scrollLeft.current = event.currentTarget.scrollLeft
          measure(event.currentTarget)
        }}
      >
        {/* No API key on the server: no daily summary at all. Grey once the last one was read; violet otherwise.
            None written yet (or the last one failed): the click writes one (1 AI call, Antho's choice) and
            opens its story, which waits for it; while it is written the ring turns and clicks do nothing more. */}
        {dailySummary?.status !== 'unavailable' && (
          <a
            className={`${styles.story} ${styles.dailySummary} ${dailySummarySeen ? styles.seen : ''} ${writing ? styles.writing : ''}`}
            href={DAILY_SUMMARY_HREF}
            aria-label={t(
              writing
                ? 'dailySummary.bubbleWriting'
                : dailySummarySeen
                  ? 'dailySummary.bubbleSeen'
                  : 'dailySummary.name'
            )}
            aria-busy={writing || undefined}
            onClick={() => {
              if (!writing && (dailySummary?.status === 'none' || dailySummary?.status === 'failed'))
                void requestDailySummary().catch(() => {})
            }}
          >
            <span className={styles.ring}>
              <span className={`${styles.picture} ${styles.dailySummaryFace}`}>
                <SparkleIcon size={layout === 'phone' ? 24 : 22} />
              </span>
            </span>
            <span className={styles.label}>{shortLabel(t('dailySummary.bubble'))}</span>
          </a>
        )}
        {sorted.map(section => {
          const seen = isSectionSeen(section)
          const pictured = section.items.find(item => item.image)
          return (
            <a
              key={section.id}
              className={`${styles.story} ${seen ? styles.seen : ''}`}
              href={storyHref(section.id)}
              data-topic={section.id}
              aria-label={t(seen ? 'stories.bubbleSeen' : 'stories.of', { topic: section.label })}
            >
              <span className={styles.ring}>
                <span className={styles.picture}>{pictured && <Face key={pictured.id} item={pictured} />}</span>
              </span>
              <span className={styles.label}>{shortLabel(section.label)}</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}

// The row's place while "À la une" comes, at its exact height: the list under it does not move when it arrives.
export const StoriesRowSkeleton = ({ layout }: { layout: StoriesRowProps['layout'] }) => {
  const size = layout === 'phone' ? 62 : 56
  return (
    <div className={`${styles.wrap} ${styles[layout]}`} aria-hidden="true">
      <div className={styles.row}>
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className={styles.story}>
            <Bar width={size} height={size} radius={size / 2} />
            <span className={styles.label}>{'\u00a0'}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export default StoriesRow
