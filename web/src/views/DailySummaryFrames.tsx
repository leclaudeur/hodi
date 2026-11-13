import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { type PointerEvent, type ReactNode, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { DailySummaryGroup } from '../lib/daily-summary.ts'
import { FRONT_PAGE_HREF } from '../lib/use-hash-route.ts'
import RoundButton from '../ui/RoundButton.tsx'
import SparkleIcon from '../ui/SparkleIcon.tsx'
import { CloseStories } from './StoryFrames.tsx'
// After StoryViewer's: this story's rules win over the frame they share.
import storyStyles from './StoryViewer.module.css'
import styles from './DailySummaryStory.module.css'

export interface SummaryFrameProps {
  groups: DailySummaryGroup[]
  index: number
  // A daily summary is there to read.
  shown: boolean
  regenerate: ReactNode
  listen: ReactNode
  // Loading, writing, nothing yet or an error; null once there is one to read.
  waiting: ReactNode
  topic: ReactNode
  paragraphs: ReactNode
  meta: ReactNode
  voice: ReactNode
  next: () => void
  previous: () => void
}

// On a computer: the page in a violet card, its tools and arrows above it.
export const DesktopSummary = (props: SummaryFrameProps) => {
  const { groups, index, shown, regenerate, listen, waiting, topic, paragraphs, meta, voice, next, previous } = props
  const { t } = useTranslation()
  return (
    <div className={`${storyStyles.desktop} ${styles.desktop}`} data-topic={groups[index]?.topicId ?? undefined}>
      <div className={`${storyStyles.header} ${styles.header}`}>
        <span className={`${storyStyles.kicker} ${styles.kicker}`}>
          <SparkleIcon size={12} />
          {t('dailySummary.name')}
        </span>
        <span className={styles.tools}>
          {shown && regenerate}
          {listen}
          {groups.length > 1 && (
            <span className={storyStyles.stepper}>
              {/* 44, as "Régénérer" beside them: one height in the row. */}
              <RoundButton
                icon={ChevronLeft}
                label={t('stories.previous')}
                size={44}
                onClick={previous}
                disabled={index === 0}
              />
              <span className={storyStyles.count}>
                {index + 1} / {groups.length}
              </span>
              <RoundButton icon={ChevronRight} label={t('stories.next')} size={44} onClick={next} />
            </span>
          )}
          <CloseStories />
        </span>
      </div>
      {groups.length > 0 && (
        <div className={storyStyles.bars} aria-hidden="true">
          {groups.map((each, eachIndex) => (
            <span
              key={each.topicId ?? each.label}
              className={`${storyStyles.bar} ${eachIndex <= index ? `${storyStyles.done} ${styles.done}` : ''}`}
            />
          ))}
        </div>
      )}
      <div className={styles.card}>
        {waiting ?? (
          <>
            {topic}
            {paragraphs}
          </>
        )}
      </div>
      {meta}
      {voice}
    </div>
  )
}

// On a phone: full screen, a tap on the left third goes back, anywhere else goes on.
export const PhoneSummary = (props: SummaryFrameProps) => {
  const { groups, index, shown, regenerate, listen, waiting, topic, paragraphs, meta, voice, next, previous } = props
  const { t } = useTranslation()
  const group = groups[index]
  // Where and when the finger went down, to tell a tap from a scroll of the text.
  const pressed = useRef({ x: 0, y: 0, at: 0 })
  const body = useRef<HTMLDivElement>(null)

  // Each page opens on its first line.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 })
  }, [index])

  // A scroll of the text is not a tap.
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const { x, y, at } = pressed.current
    if (Math.hypot(event.clientX - x, event.clientY - y) > 10 || event.timeStamp - at > 400) return
    if ((event.target as HTMLElement).closest('a, button')) return
    const { left, width } = event.currentTarget.getBoundingClientRect()
    if (event.clientX - left < width / 3) previous()
    else next()
  }

  return (
    <div
      className={`${storyStyles.phone} ${styles.phone}`}
      data-topic={group?.topicId ?? undefined}
      role="dialog"
      aria-modal="true"
      aria-label={group ? t('dailySummary.of', { topic: group.label }) : t('dailySummary.name')}
      onPointerDown={event => (pressed.current = { x: event.clientX, y: event.clientY, at: event.timeStamp })}
      onPointerUp={shown ? handlePointerUp : undefined}
    >
      <div className={styles.phoneTop}>
        {groups.length > 0 && (
          <div className={storyStyles.phoneBars} aria-hidden="true">
            {groups.map((each, eachIndex) => (
              <span key={each.topicId ?? each.label} className={storyStyles.phoneBar}>
                {eachIndex <= index && <span className={`${storyStyles.fill} ${styles.fill}`} />}
              </span>
            ))}
          </div>
        )}
        <div className={storyStyles.topRow}>
          <span className={styles.phoneMark}>
            <span className={styles.markIcon}>
              <SparkleIcon size={14} />
            </span>
            {t('dailySummary.name')}
          </span>
          <span className={styles.phoneTools}>
            {listen}
            <a className={storyStyles.close} href={FRONT_PAGE_HREF} aria-label={t('common.close')} data-shortcut="back">
              <X size={18} aria-hidden="true" />
            </a>
          </span>
        </div>
      </div>
      <div ref={body} className={styles.phoneBody}>
        {topic}
        {waiting ?? paragraphs}
      </div>
      {shown && (
        <div className={styles.phoneBottom}>
          {meta}
          {regenerate}
        </div>
      )}
      {voice}
    </div>
  )
}
