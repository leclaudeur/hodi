import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type DailySummaryResult, UnauthorizedError } from '../api.ts'
import { useAiCapped } from '../lib/ai-left.ts'
import {
  dailySummaryStoryId,
  writtenAt,
  groupsOf,
  loadDailySummary,
  readingMinutes,
  useDailySummaryWriting,
  useDailySummary,
  requestDailySummary
} from '../lib/daily-summary.ts'
import { useFrontPage } from '../lib/front-page.ts'
import { orderTopics, usePreferences } from '../lib/preferences.ts'
import { markStorySeen } from '../lib/seen-stories.ts'
import { useSpeech } from '../lib/speech.ts'
import { FRONT_PAGE_HREF, storyHref } from '../lib/use-hash-route.ts'
import { DesktopSummary, PhoneSummary } from './DailySummaryFrames.tsx'
import {
  ListenButton,
  RegenerateButton,
  SummaryParagraphs,
  SummaryTopic,
  VoiceText,
  summaryWaiting
} from './DailySummaryParts.tsx'
import { isSectionSeen } from './StoriesRow.tsx'
import { useArrowKeys, useLockedPage } from './StoryFrames.tsx'
import styles from './DailySummaryStory.module.css'

// The server hands back the same daily summary when asked again sooner than this: no new one offered before.
const MIN_AGE_MS = 30 * 60 * 1000

interface SummaryStoryProps {
  layout: 'desktop' | 'phone'
  onUnauthorized: () => void
}

// A new daily summary is offered once the last one is older than MIN_AGE_MS: the button wakes up then, once.
const useNextAt = (dailySummary: DailySummaryResult | null) => {
  const [now, setNow] = useState(Date.now)
  const nextAt = dailySummary?.status === 'ok' ? new Date(dailySummary.generatedAt).getTime() + MIN_AGE_MS : null
  useEffect(() => {
    if (nextAt === null || nextAt <= Date.now()) return
    const timer = window.setTimeout(() => setNow(Date.now()), nextAt - Date.now() + 500)
    return () => window.clearTimeout(timer)
  }, [nextAt])
  return { nextAt, ready: nextAt !== null && nextAt <= now }
}

// The last daily summary, asked on each visit (reading it is free), and seen once shown.
const useLastSummary = (onUnauthorized: () => void) => {
  const dailySummary = useDailySummary()
  useEffect(() => {
    loadDailySummary().catch((error: unknown) => {
      if (error instanceof UnauthorizedError) onUnauthorized()
    })
  }, [onUnauthorized])
  const generatedAt = dailySummary?.status === 'ok' ? dailySummary.generatedAt : null
  useEffect(() => {
    if (generatedAt) markStorySeen(dailySummaryStoryId(generatedAt))
  }, [generatedAt])
  return { dailySummary, generatedAt, points: dailySummary?.status === 'ok' ? dailySummary.points : null }
}

// "Résumé du jour" as the first of "À la une"'s stories: the day written by the AI from the front page,
// a page per topic and a paragraph per news. Reading the last one is free; writing one is a click (the
// bubble when none is written, or a violet button here). No page turns on its own: a paragraph takes
// longer than a picture.
const DailySummaryStory = ({ layout, onUnauthorized }: SummaryStoryProps) => {
  const { t } = useTranslation()
  const { dailySummary, generatedAt, points } = useLastSummary(onUnauthorized)
  const preferences = usePreferences()
  const sections = useFrontPage()
  const writing = useDailySummaryWriting()
  const [page, setPage] = useState(0)
  const everything = useRef<HTMLDivElement>(null)
  // The page follows the voice from one topic to the next.
  const speech = useSpeech(everything, 'fr', block => {
    const reached = Number(block.closest<HTMLElement>('section')?.dataset.page)
    if (Number.isInteger(reached)) setPage(reached)
  })
  const sectionOf = (shown: number) => everything.current?.querySelector<HTMLElement>(`[data-page="${shown}"]`) ?? null
  useLockedPage(layout === 'phone')
  const { nextAt, ready } = useNextAt(dailySummary)
  const groups = useMemo(() => (points ? groupsOf(points, preferences) : []), [points, preferences])

  // A new daily summary starts at its first page.
  const [shownAt, setShownAt] = useState(generatedAt)
  if (shownAt !== generatedAt) {
    setShownAt(generatedAt)
    setPage(0)
  }
  const index = Math.min(page, Math.max(groups.length - 1, 0))
  const group = groups[index]

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
  useArrowKeys(next, previous)

  const write = () =>
    void requestDailySummary().catch((error: unknown) => {
      if (error instanceof UnauthorizedError) onUnauthorized()
    })
  const capped = useAiCapped('dailySummary')
  const shown = points !== null
  const frame = {
    groups,
    index,
    shown,
    regenerate: (
      <RegenerateButton
        writing={writing}
        canRegenerate={ready && !capped}
        capped={capped}
        nextAt={nextAt}
        onWrite={write}
      />
    ),
    // From the page shown, not from the first topic.
    listen: shown && speech.supported && (
      <ListenButton state={speech.state} layout={layout} onToggle={() => speech.toggle(sectionOf(index))} />
    ),
    waiting: summaryWaiting({ dailySummary, writing, shown, capped, onWrite: write, t }),
    topic: group && <SummaryTopic group={group} />,
    paragraphs: group && <SummaryParagraphs group={group} />,
    meta: generatedAt && (
      <p className={styles.meta}>
        {t('dailySummary.meta', { time: writtenAt(generatedAt), minutes: points ? readingMinutes(points) : 0 })}
      </p>
    ),
    voice: <VoiceText groups={groups} textRef={everything} />,
    next,
    previous
  }
  return layout === 'desktop' ? <DesktopSummary {...frame} /> : <PhoneSummary {...frame} />
}

export default DailySummaryStory
