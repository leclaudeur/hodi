import { ArrowRight, AudioLines, ChevronLeft, ChevronRight, LoaderCircle, Pause, RefreshCw, X } from 'lucide-react'
import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UnauthorizedError } from '../api.ts'
import { useAiCapped } from '../lib/ai-left.ts'
import {
  DAILY_SUMMARY_ERRORS,
  dailySummaryStoryId,
  writtenAt,
  groupsOf,
  loadDailySummary,
  readingMinutes,
  useDailySummaryWriting,
  useDailySummary,
  requestDailySummary
} from '../lib/daily-summary.ts'
import { clockTime } from '../lib/format.ts'
import { useFrontPage } from '../lib/front-page.ts'
import { orderTopics, usePreferences } from '../lib/preferences.ts'
import { markStorySeen } from '../lib/seen-stories.ts'
import { useSpeech } from '../lib/speech.ts'
import { FRONT_PAGE_HREF, storyHref, topicHref } from '../lib/use-hash-route.ts'
import Button from '../ui/Button.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import { Bar } from '../ui/Skeleton.tsx'
import SparkleIcon from '../ui/SparkleIcon.tsx'
import TopicCapsule from '../ui/TopicCapsule.tsx'
import { isSectionSeen } from './StoriesRow.tsx'
import { CloseStories, useLockedPage } from './StoryViewer.tsx'
// After StoryViewer's: this story's rules win over the frame they share.
import storyStyles from './StoryViewer.module.css'
import styles from './DailySummaryStory.module.css'

// The server hands back the same daily summary when asked again sooner than this: no new one offered before.
const MIN_AGE_MS = 30 * 60 * 1000

interface SummaryStoryProps {
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

// "Résumé du jour" as the first of "À la une"'s stories: the day written by the AI from the front page,
// a page per topic and a paragraph per news. Reading the last one is free; writing one is a click (the
// bubble when none is written, or a violet button here). No page turns on its own: a paragraph takes
// longer than a picture.
const DailySummaryStory = ({ layout, onUnauthorized }: SummaryStoryProps) => {
  const { t } = useTranslation()
  const dailySummary = useDailySummary()
  const preferences = usePreferences()
  const sections = useFrontPage()
  const writing = useDailySummaryWriting()
  const [page, setPage] = useState(0)
  // Where and when the finger went down, to tell a tap from a scroll of the text.
  const pressed = useRef({ x: 0, y: 0, at: 0 })
  const everything = useRef<HTMLDivElement>(null)
  // The page follows the voice from one topic to the next.
  const speech = useSpeech(everything, 'fr', block => {
    const reached = Number(block.closest<HTMLElement>('section')?.dataset.page)
    if (Number.isInteger(reached)) setPage(reached)
  })
  const sectionOf = (shown: number) => everything.current?.querySelector<HTMLElement>(`[data-page="${shown}"]`) ?? null
  const body = useRef<HTMLDivElement>(null)
  useLockedPage(layout === 'phone')

  // A new daily summary is offered once the last one is older than MIN_AGE_MS: the button wakes up then, once.
  const [now, setNow] = useState(Date.now)
  const nextAt = dailySummary?.status === 'ok' ? new Date(dailySummary.generatedAt).getTime() + MIN_AGE_MS : null
  useEffect(() => {
    if (nextAt === null || nextAt <= Date.now()) return
    const timer = window.setTimeout(() => setNow(Date.now()), nextAt - Date.now() + 500)
    return () => window.clearTimeout(timer)
  }, [nextAt])

  useEffect(() => {
    loadDailySummary().catch((error: unknown) => {
      if (error instanceof UnauthorizedError) onUnauthorized()
    })
  }, [onUnauthorized])

  const points = dailySummary?.status === 'ok' ? dailySummary.points : null
  const groups = useMemo(() => (points ? groupsOf(points, preferences) : []), [points, preferences])
  const generatedAt = dailySummary?.status === 'ok' ? dailySummary.generatedAt : null

  useEffect(() => {
    if (generatedAt) markStorySeen(dailySummaryStoryId(generatedAt))
  }, [generatedAt])

  // A new daily summary starts at its first page.
  const [shownAt, setShownAt] = useState(generatedAt)
  if (shownAt !== generatedAt) {
    setShownAt(generatedAt)
    setPage(0)
  }

  const index = Math.min(page, Math.max(groups.length - 1, 0))
  const group = groups[index]

  // Each page opens on its first line.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 })
  }, [index])
  // After the last topic, on to the first of "À la une"'s stories not seen yet, as from one story to the
  // next; none left closes the stories.
  // Turned by hand while the voice runs, the voice goes on from the new page.
  const turnTo = (shown: number) => {
    setPage(shown)
    speech.jump(sectionOf(shown))
  }
  const next = () => {
    if (index < groups.length - 1) return turnTo(index + 1)
    const following =
      sections &&
      orderTopics(sections, preferences).find(section => section.items.length > 0 && !isSectionSeen(section))
    window.location.hash = following ? storyHref(following.id) : FRONT_PAGE_HREF
  }
  const previous = () => {
    if (index > 0) turnTo(index - 1)
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') next()
      else if (event.key === 'ArrowLeft') previous()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  const write = () =>
    requestDailySummary().catch((error: unknown) => {
      if (error instanceof UnauthorizedError) onUnauthorized()
    })

  const capped = useAiCapped('dailySummary')
  const canRegenerate = nextAt !== null && nextAt <= now && !capped
  const regenerate = (
    <Button
      look="ai"
      icon={RefreshCw}
      busy={writing}
      className={styles.regenerate}
      aria-label={t(writing ? 'dailySummary.writingShort' : 'dailySummary.regenerate')}
      onClick={() => void write()}
      disabled={!canRegenerate}
      title={
        canRegenerate
          ? t('dailySummary.writeNew')
          : capped
            ? t('dailySummary.capped')
            : t('dailySummary.upToDate', { time: nextAt === null ? '' : clockTime(nextAt) })
      }
    >
      <span className={styles.regenerateLabel}>
        {t(writing ? 'dailySummary.writingShort' : 'dailySummary.regenerate')}
      </span>
    </Button>
  )
  const speechLabel = t(
    speech.state === 'playing'
      ? 'speech.pause'
      : speech.state === 'paused'
        ? 'speech.resumeShort'
        : speech.state === 'loading'
          ? 'speech.preparing'
          : 'dailySummary.listen'
  )
  const listen = points && speech.supported && (
    <RoundButton
      icon={speech.state === 'playing' ? Pause : speech.state === 'loading' ? LoaderCircle : AudioLines}
      busy={speech.state === 'loading'}
      label={speechLabel}
      size={44}
      variant={speech.state === 'idle' ? (layout === 'phone' ? 'image' : 'default') : 'on'}
      aria-pressed={speech.state !== 'idle'}
      // From the page shown, not from the first topic.
      onClick={() => speech.toggle(sectionOf(index))}
    />
  )

  // What the story shows besides a daily summary: loading, writing, nothing yet, or what went wrong.
  let waiting = null
  if (!dailySummary || (writing && !points)) {
    waiting = (
      <div className={styles.loading} aria-busy="true" role="status">
        <span className={styles.loadingLabel}>
          <span className={styles.loadingMark}>
            <SparkleIcon size={12} />
          </span>
          {t(writing ? 'dailySummary.writing' : 'common.loading')}
        </span>
        {/* The paragraphs to come, in the card's violet. */}
        {['100%', '94%', '97%', '58%'].map((width, line) => (
          <Bar key={line} width={width} height={14} className={styles.loadingLine} />
        ))}
      </div>
    )
  } else if (dailySummary.status === 'unavailable') {
    waiting = (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>{t('dailySummary.none')}</h2>
        <p className={styles.emptyText}>{t('dailySummary.unavailable')}</p>
      </div>
    )
  } else if (dailySummary.status !== 'ok') {
    const error = DAILY_SUMMARY_ERRORS[dailySummary.status]
    waiting = (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>{t(error ?? 'dailySummary.pitch')}</h2>
        <p className={styles.emptyText}>{t(error ? 'dailySummary.nothingLost' : 'dailySummary.pitchText')}</p>
        {dailySummary.status !== 'limited' && (
          <Button
            look="ai"
            icon={SparkleIcon}
            onClick={() => void write()}
            busy={writing}
            disabled={capped}
            className={styles.generate}
          >
            {t(writing ? 'dailySummary.writingShort' : error ? 'common.retry' : 'dailySummary.generate')}
          </Button>
        )}
      </div>
    )
  }

  const minutes = points ? readingMinutes(points) : 0
  const meta = generatedAt && (
    <p className={styles.meta}>{t('dailySummary.meta', { time: writtenAt(generatedAt), minutes })}</p>
  )
  const paragraphs = group && (
    <>
      {group.points.map(point => (
        <p key={point.text} className={styles.point}>
          {point.text}
        </p>
      ))}
      {group.topicId && (
        <a className={styles.articles} href={topicHref(group.topicId)}>
          {t('dailySummary.articles')}
          <ArrowRight size={12} aria-hidden="true" />
        </a>
      )}
    </>
  )
  // The page's topic heads its text, in its capsule, at every size.
  const topic = group && (
    <span className={storyStyles.phoneTopic}>
      {group.topicId ? <TopicCapsule topicId={group.topicId} label={group.label} href={null} /> : group.label}
    </span>
  )
  // The whole daily summary for the voice, whatever page is shown.
  const forVoice = (
    <div ref={everything} hidden>
      {groups.map((each, eachIndex) => (
        <section key={each.topicId ?? each.label} data-page={eachIndex}>
          <h3>{each.label}</h3>
          {each.points.map(point => (
            <p key={point.text}>{point.text}</p>
          ))}
        </section>
      ))}
    </div>
  )

  if (layout === 'desktop')
    return (
      <div className={`${storyStyles.desktop} ${styles.desktop}`} data-topic={group?.topicId ?? undefined}>
        <div className={`${storyStyles.header} ${styles.header}`}>
          <span className={`${storyStyles.kicker} ${styles.kicker}`}>
            <SparkleIcon size={12} />
            {t('dailySummary.name')}
          </span>
          <span className={styles.tools}>
            {points && regenerate}
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
        {forVoice}
      </div>
    )

  // A tap on the left third goes back, anywhere else goes on; a scroll of the text is not a tap.
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
      onPointerUp={points ? handlePointerUp : undefined}
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
      {points && (
        <div className={styles.phoneBottom}>
          {meta}
          {regenerate}
        </div>
      )}
      {forVoice}
    </div>
  )
}

export default DailySummaryStory
