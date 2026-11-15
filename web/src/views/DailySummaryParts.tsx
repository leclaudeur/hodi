import { ArrowRight, AudioLines, LoaderCircle, Pause, RefreshCw } from 'lucide-react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { DailySummaryResult } from '../api.ts'
import { DAILY_SUMMARY_ERRORS, type DailySummaryGroup } from '../lib/daily-summary.ts'
import { clockTime } from '../lib/format.ts'
import type { SpeechState } from '../lib/speech.ts'
import { topicHref } from '../lib/use-hash-route.ts'
import Button from '../ui/Button.tsx'
import RoundButton from '../ui/RoundButton.tsx'
import { Bar } from '../ui/Skeleton.tsx'
import SparkleIcon from '../ui/SparkleIcon.tsx'
import TopicCapsule from '../ui/TopicCapsule.tsx'
import storyStyles from './StoryViewer.module.css'
import styles from './DailySummaryStory.module.css'

interface RegenerateProps {
  writing: boolean
  // A new one can be asked: the last one is old enough and today's AI is not used up.
  canRegenerate: boolean
  capped: boolean
  // When a new one can be asked.
  nextAt: number | null
  onWrite: () => void
}

// The violet button that writes a new daily summary (1 AI call); its title says why it waits.
export const RegenerateButton = ({ writing, canRegenerate, capped, nextAt, onWrite }: RegenerateProps) => {
  const { t } = useTranslation()
  let title = t('dailySummary.upToDate', { time: nextAt === null ? '' : clockTime(nextAt) })
  if (canRegenerate) title = t('dailySummary.writeNew')
  else if (capped) title = t('dailySummary.capped')
  const label = t(writing ? 'dailySummary.writingShort' : 'dailySummary.regenerate')
  return (
    <Button
      look="ai"
      icon={RefreshCw}
      busy={writing}
      className={styles.regenerate}
      aria-label={label}
      onClick={onWrite}
      disabled={!canRegenerate}
      title={title}
    >
      <span className={styles.regenerateLabel}>{label}</span>
    </Button>
  )
}

const SPEECH_LABELS = {
  playing: 'speech.pause',
  paused: 'speech.resumeShort',
  loading: 'speech.preparing',
  idle: 'dailySummary.listen'
} as const

const SPEECH_ICONS = { playing: Pause, loading: LoaderCircle, paused: AudioLines, idle: AudioLines }

interface ListenProps {
  state: SpeechState
  layout: 'desktop' | 'phone'
  onToggle: () => void
}

// Reads the daily summary aloud, in the browser's voice.
export const ListenButton = ({ state, layout, onToggle }: ListenProps) => {
  const { t } = useTranslation()
  const idleLook = layout === 'phone' ? 'image' : 'default'
  return (
    <RoundButton
      icon={SPEECH_ICONS[state]}
      busy={state === 'loading'}
      label={t(SPEECH_LABELS[state])}
      size={44}
      variant={state === 'idle' ? idleLook : 'on'}
      aria-pressed={state !== 'idle'}
      onClick={onToggle}
    />
  )
}

interface WaitingInput {
  dailySummary: DailySummaryResult | null
  writing: boolean
  // A daily summary is there to show.
  shown: boolean
  capped: boolean
  onWrite: () => void
  t: TFunction
}

// What the story shows besides a daily summary: loading, writing, nothing yet, or what went wrong. Null once there
// is one to read.
export const summaryWaiting = ({ dailySummary, writing, shown, capped, onWrite, t }: WaitingInput) => {
  if (!dailySummary || (writing && !shown))
    return (
      <div className={styles.loading} aria-busy="true" role="status">
        <span className={styles.loadingLabel}>
          <span className={styles.loadingMark}>
            <SparkleIcon size={12} />
          </span>
          {t(writing ? 'dailySummary.writing' : 'common.loading')}
        </span>
        {/* The paragraphs to come, in the card's violet. */}
        {['100%', '94%', '97%', '58%'].map((width, line) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- placeholder lines, fixed
          <Bar key={line} width={width} height={14} className={styles.loadingLine} />
        ))}
      </div>
    )
  if (dailySummary.status === 'unavailable')
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>{t('dailySummary.none')}</h2>
        <p className={styles.emptyText}>{t('dailySummary.unavailable')}</p>
      </div>
    )
  if (dailySummary.status === 'ok') return null
  const error = DAILY_SUMMARY_ERRORS[dailySummary.status]
  let action: 'dailySummary.writingShort' | 'common.retry' | 'dailySummary.generate' = 'dailySummary.generate'
  if (writing) action = 'dailySummary.writingShort'
  else if (error) action = 'common.retry'
  return (
    <div className={styles.empty}>
      <h2 className={styles.emptyTitle}>{t(error ?? 'dailySummary.pitch')}</h2>
      <p className={styles.emptyText}>{t(error ? 'dailySummary.nothingLost' : 'dailySummary.pitchText')}</p>
      {dailySummary.status !== 'limited' && (
        <Button
          look="ai"
          icon={SparkleIcon}
          onClick={onWrite}
          busy={writing}
          disabled={capped}
          className={styles.generate}
        >
          {t(action)}
        </Button>
      )}
    </div>
  )
}

// A page's paragraphs, then the way to its topic's articles.
export const SummaryParagraphs = ({ group }: { group: DailySummaryGroup }) => {
  const { t } = useTranslation()
  return (
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
}

// The page's topic heads its text, in its capsule, at every size.
export const SummaryTopic = ({ group }: { group: DailySummaryGroup }) => (
  <span className={storyStyles.phoneTopic}>
    {group.topicId ? <TopicCapsule topicId={group.topicId} label={group.label} href={null} /> : group.label}
  </span>
)

// The whole daily summary for the voice, whatever page is shown.
export const VoiceText = ({
  groups,
  textRef
}: {
  groups: DailySummaryGroup[]
  textRef: RefObject<HTMLDivElement | null>
}) => (
  <div ref={textRef} hidden>
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
