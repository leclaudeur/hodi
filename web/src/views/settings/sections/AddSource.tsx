import { Link2, Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AddSourceError,
  type FindSourceResult,
  TOPICS_CHANGED,
  type TopicInfo,
  UnauthorizedError,
  addSource,
  findSource,
  getListen
} from '../../../api.ts'
import { readingLine } from '../../../lib/found-source.ts'
import Button from '../../../ui/Button.tsx'
import Chip from '../../../ui/Chip.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import TextField from '../../../ui/TextField.tsx'
import TopicCapsule from '../../../ui/TopicCapsule.tsx'
import styles from '../Settings.module.css'
import addStyles from './AddSource.module.css'
import TopicField from './TopicField.tsx'

// Each failure's text is addSource.errors.<code>.
type NotFound = Exclude<FindSourceResult['status'], 'ok'>
const notFound = (code: NotFound) => `addSource.errors.${code}` as const
const addError = (code: AddSourceError) => `addSource.errors.${code}` as const

interface AddSourceProps {
  topics: TopicInfo[]
  // The topic a found site goes to unless changed: the one of a source being replaced.
  topicHint?: string | null
  onAdded: (id: string) => void
  onUnauthorized: () => void
}

type Found = Extract<FindSourceResult, { status: 'ok' }>

// The form's state: the link, the site found from it and where it goes.
const useAddSource = ({ topicHint = null, onAdded, onUnauthorized }: Omit<AddSourceProps, 'topics'>) => {
  const { t } = useTranslation()
  const [link, setLink] = useState('')
  const [searching, setSearching] = useState(false)
  const [found, setFound] = useState<FindSourceResult | null>(null)
  // Where videos go: the sections of Vidéos.
  const [sections, setSections] = useState<{ id: string; label: string }[]>([])
  // Articles go to one topic or several, videos to one section.
  const [targets, setTargets] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fail = (failure: unknown, message: string) => {
    if (failure instanceof UnauthorizedError) onUnauthorized()
    else setError(message)
  }

  const search = async (event: FormEvent) => {
    event.preventDefault()
    if (!link.trim()) return
    setSearching(true)
    setFound(null)
    setTargets([])
    setError(null)
    try {
      const result = await findSource(link.trim())
      setFound(result)
      if (result.status === 'ok' && result.source.kind === 'article' && topicHint) setTargets([topicHint])
      if (result.status === 'ok' && result.source.kind !== 'article' && sections.length === 0) {
        setSections((await getListen()).sections.map(({ id, label }) => ({ id, label })))
      }
    } catch (failure) {
      fail(failure, t(notFound('failed')))
    } finally {
      setSearching(false)
    }
  }

  const add = async () => {
    if (!found || found.status !== 'ok' || targets.length === 0) return
    setAdding(true)
    setError(null)
    try {
      const result = await addSource(link.trim(), found.source.kind === 'article' ? 'topic' : 'listen', targets)
      if (result.ok) {
        setLink('')
        setFound(null)
        setTargets([])
        window.dispatchEvent(new Event(TOPICS_CHANGED))
        onAdded(result.id)
      } else {
        setError(t(addError(result.error)))
      }
    } catch (failure) {
      fail(failure, t(addError('failed')))
    } finally {
      setAdding(false)
    }
  }

  return { link, setLink, searching, found, sections, targets, setTargets, adding, error, search, add }
}

type AddSourceState = ReturnType<typeof useAddSource>

// Which topics a found site goes to, or which section of Vidéos a channel, then « Ajouter ».
const TargetChoice = ({ found, topics, state }: { found: Found; topics: TopicInfo[]; state: AddSourceState }) => {
  const { t } = useTranslation()
  const { targets, setTargets, adding } = state
  const article = found.source.kind === 'article'
  return (
    <>
      <h3 className={styles.label}>{t(article ? 'addSource.whichTopics' : 'addSource.whichSection')}</h3>
      {article ? (
        <TopicField topics={topics} selected={targets} onChange={setTargets} label={t('addSource.topics')} />
      ) : (
        <div className={addStyles.choices}>
          {state.sections.map(choice => (
            <TopicCapsule
              key={choice.id}
              topicId={choice.id}
              label={choice.label}
              size="filter"
              selected={targets.includes(choice.id)}
              // A second click takes the choice back.
              onClick={() => setTargets(targets.includes(choice.id) ? [] : [choice.id])}
            />
          ))}
        </div>
      )}
      <div className={addStyles.actions}>
        <span className={addStyles.count}>
          {found.limit === null
            ? t('addSource.countAll', { count: found.added })
            : t('addSource.count', { added: found.added, limit: found.limit })}
        </span>
        <Button
          look="primary"
          icon={Plus}
          busy={adding}
          disabled={targets.length === 0}
          onClick={() => void state.add()}
        >
          {t(adding ? 'addSource.adding' : 'profiles.add')}
        </Button>
      </div>
    </>
  )
}

// The site found: its name, how it is read, a few of its titles, then where it goes.
const FoundSource = ({ found, topics, state }: { found: Found; topics: TopicInfo[]; state: AddSourceState }) => {
  const { t } = useTranslation()
  const { source } = found
  const full = found.limit !== null && found.added >= found.limit
  return (
    <div className={addStyles.found}>
      <div className={addStyles.head}>
        <span className={styles.rowText}>
          <span className={styles.rowLabel}>{source.name}</span>
          <span className={styles.rowHint}>{readingLine(source)}</span>
        </span>
        <Chip>{t(`addSource.origins.${source.origin}`)}</Chip>
      </div>
      <ul className={addStyles.samples}>
        {source.samples.map(title => (
          <li key={title}>{title}</li>
        ))}
      </ul>
      {found.followed && (
        <StatusLine tone="info">{t('addSource.followedAs', { name: found.followed.name })}</StatusLine>
      )}
      {!found.followed && full && <StatusLine tone="error">{t(addError('limit'))}</StatusLine>}
      {!found.followed && !full && <TargetChoice found={found} topics={topics} state={state} />}
    </div>
  )
}

// "Ajouter une source": a link pasted, the feed found and tried, a topic picked.
const AddSource = ({ topics, ...props }: AddSourceProps) => {
  const { t } = useTranslation()
  const state = useAddSource(props)
  const { link, searching, found } = state

  return (
    <div className={addStyles.box}>
      <form className={styles.fieldRow} onSubmit={state.search}>
        <TextField
          icon={Link2}
          inputMode="url"
          value={link}
          onChange={event => state.setLink(event.target.value)}
          placeholder={t('addSource.placeholder')}
          aria-label={t('addSource.field')}
          maxLength={500}
          autoComplete="off"
        />
        <Button type="submit" look="primary" busy={searching} disabled={!link.trim()}>
          {t(searching ? 'addSource.searching' : 'addSource.search')}
        </Button>
      </form>

      {searching && <StatusLine tone="info">{t('addSource.trying')}</StatusLine>}

      {found && found.status !== 'ok' && <StatusLine tone="error">{t(notFound(found.status))}</StatusLine>}

      {found?.status === 'ok' && <FoundSource found={found} topics={topics} state={state} />}

      {state.error && <StatusLine tone="error">{state.error}</StatusLine>}
    </div>
  )
}

export default AddSource
