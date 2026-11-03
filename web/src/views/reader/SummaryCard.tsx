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
  | { status: 'ok'; points: string[] }
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
  onUnauthorized: () => void
}

// "Pas le temps ?": the article's key points, written by the AI only when "Résumer" is clicked.
const LanguageSummaryCard = ({ articleId, language, onUnauthorized }: SummaryCardProps & { language: Language }) => {
  const { t } = useTranslation()
  const [state, setState] = useState<State>(() => {
    const points = findSummary(articleId, language)
    return points ? { status: 'ok', points } : { status: 'idle' }
  })
  const capped = useAiCapped('summary')

  const summarize = async () => {
    setState({ status: 'loading' })
    try {
      const result = await summarizeArticle(articleId)
      if (result.status === 'ok') {
        keepSummary(articleId, language, result.points)
        setState(result)
      } else {
        setState({ status: 'error', ...(errorMessages[result.status] ?? FAILED) })
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) onUnauthorized()
      else setState({ status: 'error', ...FAILED })
    }
    void refreshAiUsage()
  }

  if (state.status === 'idle')
    return (
      <div className={styles.offer} id="summary">
        <span className={`${styles.mark} ${styles.offerMark}`}>
          <SparkleIcon size={16} />
        </span>
        <span className={styles.offerText}>{t(capped ? 'summary.capped' : 'summary.offer')}</span>
        <Button
          look="ai"
          icon={SparkleIcon}
          onClick={() => void summarize()}
          disabled={capped}
          data-shortcut="summarize"
        >
          {t('summary.summarize')}
        </Button>
      </div>
    )

  return (
    <section
      className={styles.card}
      id="summary"
      aria-label={t('summary.title')}
      aria-busy={state.status === 'loading'}
    >
      <div className={styles.cardHeader}>
        <span className={styles.mark}>
          <SparkleIcon size={14} />
        </span>
        <h2 className={styles.cardTitle}>{t('summary.title')}</h2>
      </div>

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
