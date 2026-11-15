import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AddSourceError,
  type SourceSuggestions as Suggestions,
  TOPICS_CHANGED,
  type TopicSummary,
  UnauthorizedError,
  addSource,
  suggestSources
} from '../../../api.ts'
import { refreshAiUsage, useAiCapped } from '../../../lib/ai-left.ts'
import { readingLine } from '../../../lib/found-source.ts'
import { getHouseholdLanguage, getLanguage } from '../../../lib/i18n.ts'
import DaySeparator from '../../../ui/DaySeparator.tsx'
import Button from '../../../ui/Button.tsx'
import SparkleIcon from '../../../ui/SparkleIcon.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import aiStyles from '../../reader/AiCards.module.css'
import styles from '../Settings.module.css'
import { SiteList, SiteRow } from './SiteList.tsx'
import suggestStyles from './SourceSuggestions.module.css'

// The add failures with their own words here; the others say it could not be added.
const ADD_FAILURES: Partial<Record<AddSourceError, 'limit' | 'followed'>> = { limit: 'limit', followed: 'followed' }

type Suggestion = Extract<Suggestions, { status: 'ok' }>['suggestions'][number]

// The sites in the profile's language, then those in the household's when it differs, as "Nos suggestions" shows
// them. The AI is asked for those two only; a site whose feed says another language stays with the first.
const groupsOf = (suggestions: Suggestion[]) => {
  const language = getLanguage()
  const household = getHouseholdLanguage()
  const inHousehold = (suggestion: Suggestion) => household !== language && suggestion.source.lang === household
  return [
    { lang: language, suggestions: suggestions.filter(suggestion => !inHousehold(suggestion)) },
    { lang: household, suggestions: suggestions.filter(inHousehold) }
  ].filter(group => group.suggestions.length > 0)
}

interface SourceSuggestionsProps {
  // The topic picked in the dialog.
  topic: TopicSummary | null
  // The little-read source the suggestions would replace.
  replacing?: string | null
  onAdded: (id: string) => void
  onUnauthorized: () => void
}

// The AI's suggestions for a topic, and adding one of them.
const useSuggestions = ({ topic, replacing = null, onAdded, onUnauthorized }: SourceSuggestionsProps) => {
  const { t } = useTranslation()
  const capped = useAiCapped('sources')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Suggestions | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [added, setAdded] = useState<Record<string, string>>({})
  const [addError, setAddError] = useState<string | null>(null)

  const suggest = async () => {
    if (!topic || capped) return
    setLoading(true)
    setResult(null)
    setAddError(null)
    try {
      setResult(await suggestSources(topic.id, replacing))
    } catch (failure) {
      if (failure instanceof UnauthorizedError) onUnauthorized()
      else setResult({ status: 'failed' })
    } finally {
      setLoading(false)
      void refreshAiUsage()
    }
  }

  const add = async (link: string) => {
    if (!topic) return
    setAdding(link)
    setAddError(null)
    try {
      const outcome = await addSource(link, 'topic', [topic.id])
      if (outcome.ok) {
        setAdded(current => ({ ...current, [link]: outcome.id }))
        window.dispatchEvent(new Event(TOPICS_CHANGED))
        onAdded(outcome.id)
      } else {
        const known = ADD_FAILURES[outcome.error]
        setAddError(known ? t(`suggest.add.${known}`) : t('suggest.add.failed'))
      }
    } catch (failure) {
      if (failure instanceof UnauthorizedError) onUnauthorized()
      else setAddError(t('suggest.add.failed'))
    } finally {
      setAdding(null)
    }
  }

  return { capped, loading, result, adding, added, addError, suggest, add }
}

interface SuggestionGroupsProps {
  suggestions: Suggestion[]
  added: Record<string, string>
  adding: string | null
  onAdd: (link: string) => void
}

// The sites found, by language, each with what it brings and its last title.
const SuggestionGroups = ({ suggestions, added, adding, onAdd }: SuggestionGroupsProps) => {
  const { t } = useTranslation()
  return groupsOf(suggestions).map((group, _index, groups) => (
    <Fragment key={group.lang}>
      {(groups.length > 1 || group.lang !== getLanguage()) && (
        <DaySeparator
          label={t(`settings.proposals.inLanguage.${group.lang}`)}
          count={group.suggestions.length}
          unit="source"
          still
          className={suggestStyles.separator}
        />
      )}
      <SiteList tone="ai">
        {group.suggestions.map(({ link, reason, source }) => (
          <SiteRow
            key={link}
            name={source.name}
            link={link}
            added={link in added}
            adding={adding === link}
            busy={adding !== null}
            onAdd={() => onAdd(link)}
          >
            <span className={suggestStyles.reason}>{reason}</span>
            <span className={styles.rowHint}>{readingLine(source)}</span>
            {source.samples[0] && (
              <span className={suggestStyles.sample}>{t('suggest.last', { title: source.samples[0] })}</span>
            )}
          </SiteRow>
        ))}
      </SiteList>
    </Fragment>
  ))
}

const offerKey = (capped: boolean, topic: TopicSummary | null) => {
  if (capped) return 'suggest.capped'
  return topic ? 'suggest.offer' : 'suggest.pickTopic'
}

// "Suggérer des sources": a violet button, one AI call, a few sites for a topic. Each comes with what it
// brings, a link to look at it, and its feed already found and tried, ready to add.
const SourceSuggestions = (props: SourceSuggestionsProps) => {
  const { t } = useTranslation()
  const { topic } = props
  const { capped, loading, result, adding, added, addError, suggest, add } = useSuggestions(props)

  return (
    // The tour's last step, when the topic has no proposal left.
    <div className={suggestStyles.box} data-tour="add-sites">
      {/* One line, as the reader's AI offers: mark, what it does, the violet button. */}
      <div className={aiStyles.offer}>
        <span className={`${aiStyles.mark} ${aiStyles.offerMark}`}>
          <SparkleIcon size={16} />
        </span>
        <span className={aiStyles.offerText}>{t(offerKey(capped, topic), { topic: topic?.label })}</span>
        <Button look="ai" icon={SparkleIcon} busy={loading} disabled={!topic || capped} onClick={() => void suggest()}>
          {t('suggest.button')}
        </Button>
      </div>

      {loading && <StatusLine tone="info">{t('suggest.loading')}</StatusLine>}

      {result && result.status !== 'ok' && <StatusLine tone="error">{t(`suggest.errors.${result.status}`)}</StatusLine>}

      {result?.status === 'ok' && result.suggestions.length === 0 && (
        <StatusLine tone="error">{t('suggest.noFeed')}</StatusLine>
      )}
      {result?.status === 'ok' && result.suggestions.length > 0 && (
        <SuggestionGroups
          suggestions={result.suggestions}
          added={added}
          adding={adding}
          onAdd={link => void add(link)}
        />
      )}

      {addError && <StatusLine tone="error">{addError}</StatusLine>}
    </div>
  )
}

export default SourceSuggestions
