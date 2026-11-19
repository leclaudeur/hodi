import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UnauthorizedError, summarizeArticle } from '../../api.ts'
import { refreshAiUsage, useAiCapped } from '../../lib/ai-left.ts'
import { type Language, useLanguage } from '../../lib/i18n.ts'
import { findSummary, keepSummary } from '../../lib/summaries.ts'
import Button from '../../ui/Button.tsx'
import SparkleIcon from '../../ui/SparkleIcon.tsx'
import styles from './AiCards.module.css'

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; points: string[]; open: boolean }
  | { status: 'error'; message: ErrorKey; retry: boolean }

type ErrorKey = `summary.errors.${'limited' | 'refused' | 'unreadable' | 'unknown' | 'unavailable' | 'failed'}`

const errorMessages: Record<string, { message: ErrorKey; retry: boolean }> = {
  limited: { message: 'summary.errors.limited', retry: false },
  refused: { message: 'summary.errors.refused', retry: false },
  unreadable: { message: 'summary.errors.unreadable', retry: false },
  unknown: { message: 'summary.errors.unknown', retry: false },
  unavailable: { message: 'summary.errors.unavailable', retry: false }
}

const FAILED = { message: 'summary.errors.failed', retry: true } as const

interface SummaryCardProps {
  articleId: string
  // Written already for this article in the reader's language, by anyone on the server: read for free.
  stored: string[] | null
  onUnauthorized: () => void
}

// Before any summary: the offer, and the violet button that spends the call. Once one exists, the same line with a
// plain button that only opens it.
const SummaryOffer = ({ capped, ready, onClick }: { capped: boolean; ready: boolean; onClick: () => void }) => {
  const { t } = useTranslation()
  return (
    // Once written, the whole line opens it, as an accordion's header. Before, only the violet button calls the AI.
    <div
      className={`${styles.offer} ${ready ? styles.openable : ''}`}
      id="summary"
      onClick={ready ? onClick : undefined}
    >
      <span className={`${styles.mark} ${styles.offerMark}`}>
        <SparkleIcon size={16} />
      </span>
      <span className={styles.offerText}>
        {t(ready ? 'summary.ready' : capped ? 'summary.capped' : 'summary.offer')}
      </span>
      {ready ? (
        <Button
          look="aiQuiet"
          icon={ChevronDown}
          onClick={event => {
            event.stopPropagation()
            onClick()
          }}
          data-shortcut="summarize"
        >
          {t('summary.read')}
        </Button>
      ) : (
        <Button look="ai" icon={SparkleIcon} onClick={onClick} disabled={capped} data-shortcut="summarize">
          {t('summary.summarize')}
        </Button>
      )}
    </div>
  )
}

// The open card's header: once written, a click on it folds the card back to its line.
const SummaryHeader = ({ onClose }: { onClose: (() => void) | null }) => {
  const { t } = useTranslation()
  return (
    <div className={`${styles.cardHeader} ${onClose ? styles.openable : ''}`} onClick={onClose ?? undefined}>
      <span className={styles.mark}>
        <SparkleIcon size={14} />
      </span>
      <h2 className={styles.cardTitle}>{t('summary.title')}</h2>
      {onClose && (
        <span className={styles.cardClose}>
          <Button look="aiQuiet" compact icon={ChevronUp}>
            {t('summary.close')}
          </Button>
        </span>
      )}
    </div>
  )
}

// "Pas le temps ?": the article's key points, written by the AI only when "Résumer" is clicked.
const LanguageSummaryCard = ({
  articleId,
  stored,
  language,
  onUnauthorized
}: SummaryCardProps & { language: Language }) => {
  const { t } = useTranslation()
  const [state, setState] = useState<State>(() => {
    const points = stored ?? findSummary(articleId, language)
    return points ? { status: 'ok', points, open: false } : { status: 'idle' }
  })
  const capped = useAiCapped('summary')

  const summarize = async () => {
    setState({ status: 'loading' })
    try {
      const result = await summarizeArticle(articleId)
      if (result.status === 'ok') {
        keepSummary(articleId, language, result.points)
        setState({ ...result, open: true })
      } else {
        setState({ status: 'error', ...(errorMessages[result.status] ?? FAILED) })
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) onUnauthorized()
      else setState({ status: 'error', ...FAILED })
    }
    void refreshAiUsage()
  }

  if (state.status === 'idle') return <SummaryOffer capped={capped} ready={false} onClick={() => void summarize()} />
  if (state.status === 'ok' && !state.open)
    return <SummaryOffer capped={capped} ready onClick={() => setState({ ...state, open: true })} />

  return (
    <section
      className={styles.card}
      id="summary"
      aria-label={t('summary.title')}
      aria-busy={state.status === 'loading'}
    >
      <SummaryHeader onClose={state.status === 'ok' ? () => setState({ ...state, open: false }) : null} />

      {state.status === 'loading' && (
        <div className={styles.lines} role="status">
          <span />
          <span />
          <span />
          <span className="visually-hidden">{t('summary.writing')}</span>
        </div>
      )}

      {state.status === 'ok' && (
        <ul className={styles.points}>
          {state.points.map(point => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}

      {state.status === 'error' && (
        <p className={styles.error}>
          {t(state.message)}
          {state.retry && !capped && (
            <Button look="ai" onClick={() => void summarize()}>
              {t('common.retry')}
            </Button>
          )}
        </p>
      )}

      {state.status === 'ok' && <span className={styles.note}>{t('summary.note')}</span>}
    </section>
  )
}

// A summary is in one language: after a switch, the card starts again in the new one and offers "Résumer".
const SummaryCard = (props: SummaryCardProps) => {
  const language = useLanguage()
  return <LanguageSummaryCard key={language} {...props} language={language} />
}

export default SummaryCard
