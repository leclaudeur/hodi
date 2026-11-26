import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TOPICS_CHANGED, type TopicSummary, UnauthorizedError, addProposal } from '../../../api.ts'
import { type CatalogueEntry, entriesOf } from '../../../lib/catalogue.ts'
import { CONFIG } from '../../../lib/config.ts'
import { getLanguage } from '../../../lib/i18n.ts'
import { setMySources } from '../../../lib/preferences.ts'
import { catalogueHref } from '../../../lib/use-hash-route.ts'
import Button from '../../../ui/Button.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import { useCatalogue } from '../../../pages/catalogue/use-catalogue.ts'
import styles from '../Settings.module.css'
import { SiteList, SiteRow } from './SiteList.tsx'
import suggestStyles from './SourceSuggestions.module.css'

interface CataloguePicksProps {
  topic: TopicSummary
  onAdded: (id: string) => void
  onUnauthorized: () => void
}

// The catalogue's sources for the topic, its most read first; with too few readers to tell, from A to Z. A source
// added here stays in the list, marked as added, so the list does not move under the pointer.
const usePicks = ({ topic, onAdded, onUnauthorized }: CataloguePicksProps) => {
  const { t } = useTranslation()
  const { entries } = useCatalogue(onUnauthorized)
  const [added, setAdded] = useState<string[]>([])
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const picks = entries
    ? entriesOf(
        entries.filter(entry => !entry.mine || added.includes(entry.id)),
        { topicId: topic.id, language: getLanguage(), sort: 'popular' }
      ).slice(0, CONFIG.sources.cataloguePicks)
    : null

  // A server's source joins « Mes sources » at once; one of sources.yml's is fetched for the server first.
  const add = async (entry: CatalogueEntry) => {
    setError(null)
    if (!entry.proposal) {
      setMySources([entry.id], true, { quiet: true })
      setAdded(current => [...current, entry.id])
      onAdded(entry.id)
      return
    }
    setAdding(entry.id)
    try {
      const outcome = await addProposal(entry.id, [topic.id])
      if (!outcome.ok) return setError(t(outcome.error === 'limit' ? 'suggest.add.limit' : 'suggest.add.failed'))
      setAdded(current => [...current, entry.id])
      window.dispatchEvent(new Event(TOPICS_CHANGED))
      onAdded(outcome.id)
    } catch (failure) {
      if (failure instanceof UnauthorizedError) onUnauthorized()
      else setError(t('suggest.add.failed'))
    } finally {
      setAdding(null)
    }
  }

  return { picks, added, adding, error, add }
}

// « Pour un thème », with or without AI: the catalogue's first sources for the topic, then the way to all of them.
const CataloguePicks = (props: CataloguePicksProps) => {
  const { t } = useTranslation()
  const { picks, added, adding, error, add } = usePicks(props)
  if (!picks) return null
  return (
    <div className={suggestStyles.box}>
      <h3 className={styles.label}>{t('settings.addSource.inCatalogue')}</h3>
      {picks.length === 0 ? (
        <p className={styles.rowHint}>{t('settings.addSource.allMine')}</p>
      ) : (
        <SiteList tone="neutral">
          {picks.map(entry => (
            <SiteRow
              key={entry.id}
              name={entry.name}
              link={entry.site}
              lang={entry.lang}
              added={added.includes(entry.id)}
              adding={adding === entry.id}
              busy={adding !== null}
              onAdd={() => void add(entry)}
            />
          ))}
        </SiteList>
      )}
      {error && <StatusLine tone="error">{error}</StatusLine>}
      <Button icon={ArrowRight} href={catalogueHref(props.topic.id)}>
        {t('settings.addSource.seeCatalogue')}
      </Button>
    </div>
  )
}

export default CataloguePicks
