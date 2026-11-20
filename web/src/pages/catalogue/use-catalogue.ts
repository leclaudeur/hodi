import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type SourceProposal,
  TOPICS_CHANGED,
  type TopicInfo,
  UnauthorizedError,
  addProposal,
  getProposals,
  getSources,
  getTopics
} from '../../api.ts'
import { type CatalogueEntry, catalogueOf } from '../../lib/catalogue.ts'
import { setMySources, usePreferences } from '../../lib/preferences.ts'
import { useSourceStatuses } from '../../lib/settings-data.ts'
import { showError, showSaved } from '../../lib/toast.ts'

// The catalogue's sources, the topics they are in, and adding one to « Mes sources » or taking it out.
export const useCatalogue = (onUnauthorized: () => void) => {
  const { t } = useTranslation()
  const { value: sources, failed, replace } = useSourceStatuses(onUnauthorized)
  const { hiddenSources } = usePreferences()
  const [topics, setTopics] = useState<TopicInfo[] | null>(null)
  const [proposals, setProposals] = useState<SourceProposal[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(
    () =>
      Promise.all([getTopics(), getProposals()])
        .then(([nextTopics, nextProposals]) => {
          setTopics(nextTopics)
          setProposals(nextProposals)
        })
        .catch((error: unknown) => {
          if (error instanceof UnauthorizedError) onUnauthorized()
          else setProposals([])
        }),
    [onUnauthorized]
  )
  useEffect(() => void load(), [load])

  const entries = sources && topics && proposals ? catalogueOf({ sources, proposals, topics, hiddenSources }) : null

  // sources.yml's source nobody added yet: fetched for the whole server, then in « Mes sources ».
  const fetchProposal = async (entry: CatalogueEntry) => {
    setBusy(entry.id)
    try {
      const outcome = await addProposal(entry.id, entry.topicIds.slice(0, 1))
      if (!outcome.ok) {
        showError(t('catalogue.addFailed'))
        return
      }
      replace(await getSources())
      await load()
      window.dispatchEvent(new Event(TOPICS_CHANGED))
      showSaved(t('catalogue.added', { name: entry.name }))
    } catch (error) {
      if (error instanceof UnauthorizedError) onUnauthorized()
      else showError(t('catalogue.addFailed'))
    } finally {
      setBusy(null)
    }
  }

  const add = (entry: CatalogueEntry) => {
    if (entry.proposal) return void fetchProposal(entry)
    setMySources([entry.id], true, { quiet: true })
    showSaved(t('catalogue.added', { name: entry.name }))
  }

  const remove = (entry: CatalogueEntry) => {
    setMySources([entry.id], false, { quiet: true })
    showSaved(t('catalogue.removed', { name: entry.name }))
  }

  return { entries, topics: topics ?? [], failed, busy, add, remove }
}
