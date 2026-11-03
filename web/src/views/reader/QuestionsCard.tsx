import { ArrowUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type FormEvent, useState } from 'react'
import { type AnswerSource, MAX_QUESTION_LENGTH, UnauthorizedError, askQuestion } from '../../api.ts'
import { refreshAiUsage, useAiCapped } from '../../lib/ai-left.ts'
import { hostOf } from '../../lib/format.ts'
import SparkleIcon from '../../ui/SparkleIcon.tsx'
import styles from './AiCards.module.css'

interface Exchange {
  question: string
  answer: string | null
  sources: AnswerSource[]
  error: ErrorKey | null
}

type ErrorKey = `questions.errors.${'limited' | 'refused' | 'unreadable' | 'unknown' | 'unavailable' | 'noAnswer'}`

const errorKeys: Record<string, ErrorKey> = {
  limited: 'questions.errors.limited',
  refused: 'questions.errors.refused',
  unreadable: 'questions.errors.unreadable',
  unknown: 'questions.errors.unknown',
  unavailable: 'questions.errors.unavailable'
}

const NO_ANSWER: ErrorKey = 'questions.errors.noAnswer'

interface QuestionsCardProps {
  articleId: string
  onUnauthorized: () => void
}

// Questions about the article, answered by the AI (which searches the web when the article is not enough).
// Each question sent is one call; they last for this visit only.
const QuestionsCard = ({ articleId, onUnauthorized }: QuestionsCardProps) => {
  const { t } = useTranslation()
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [question, setQuestion] = useState('')
  const asking = exchanges.some(exchange => exchange.answer === null && exchange.error === null)
  const capped = useAiCapped('question')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const asked = question.trim()
    if (!asked || asking || capped) return

    setQuestion('')
    setExchanges(previous => [...previous, { question: asked, answer: null, sources: [], error: null }])

    const settle = (update: Partial<Exchange>) =>
      setExchanges(previous =>
        previous.map((exchange, index) => (index === previous.length - 1 ? { ...exchange, ...update } : exchange))
      )

    try {
      const result = await askQuestion(articleId, asked)
      if (result.status === 'ok') settle({ answer: result.answer, sources: result.sources })
      else settle({ error: errorKeys[result.status] ?? NO_ANSWER })
    } catch (error) {
      if (error instanceof UnauthorizedError) onUnauthorized()
      else settle({ error: NO_ANSWER })
    }
    void refreshAiUsage()
  }

  return (
    // One line as the summary's offer: the mark, the field (its placeholder is the title), the send button.
    <section
      className={`${styles.card} ${styles.questions} ${exchanges.length === 0 ? styles.compact : ''}`}
      aria-label={t('questions.ask')}
    >
      {exchanges.length > 0 && (
        <ol className={styles.exchanges}>
          {exchanges.map((exchange, index) => (
            <li key={index}>
              <p className={styles.question}>{exchange.question}</p>
              {exchange.answer !== null && <p className={styles.answer}>{exchange.answer}</p>}
              {exchange.sources.length > 0 && (
                <ul className={styles.sources} aria-label={t('questions.sources')}>
                  {exchange.sources.map(source => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>
                        {hostOf(source.url)} ↗
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {exchange.error !== null && <p className={styles.error}>{t(exchange.error)}</p>}
              {exchange.answer === null && exchange.error === null && (
                <div className={styles.lines} role="status">
                  <span />
                  <span />
                  <span className="visually-hidden">{t('questions.answering')}</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className={styles.askRow}>
        <span className={`${styles.mark} ${styles.offerMark}`}>
          <SparkleIcon size={16} />
        </span>
        <form className={styles.form} onSubmit={event => void handleSubmit(event)}>
          <input
            className={styles.input}
            type="text"
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder={t(capped ? 'questions.capped' : 'questions.placeholder')}
            aria-label={t('questions.yours')}
            maxLength={MAX_QUESTION_LENGTH}
            disabled={capped}
            enterKeyHint="send"
          />
          <button
            className={styles.send}
            type="submit"
            disabled={asking || capped || question.trim() === ''}
            aria-label={t('questions.send')}
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </form>
      </div>
    </section>
  )
}

export default QuestionsCard
