import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type AddSourceError,
  type SourceProposal,
  TOPICS_CHANGED,
  type TopicSummary,
  UnauthorizedError,
  addProposal,
  getProposals
} from '../../../api.ts'
import { getHouseholdLanguage, getLanguage } from '../../../lib/i18n.ts'
import DaySeparator from '../../../ui/DaySeparator.tsx'
import StatusLine from '../../../ui/StatusLine.tsx'
import { SiteList, SiteRow } from './SiteList.tsx'
import styles from './SourceSuggestions.module.css'

const ADD_FAILURES: Partial<Record<AddSourceError, 'limit' | 'followed' | 'none' | 'failed'>> = {
  limit: 'limit',
  followed: 'followed',
  none: 'none',
  failed: 'failed'
}

// The household's proposals, asked again each time the dialog opens (one may have been added since).
export const useProposals = (open: boolean, onUnauthorized: () => void) => {
  const [proposals, setProposals] = useState<SourceProposal[] | null>(null)
  const unauthorized = useRef(onUnauthorized)
  useEffect(() => {
    unauthorized.current = onUnauthorized
  })

  useEffect(() => {
    if (!open) return
    let current = true
    getProposals()
      .then(result => current && setProposals(result))
      .catch((error: unknown) => {
        if (error instanceof UnauthorizedError) unauthorized.current()
        else if (current) setProposals([])
      })
    return () => {
      current = false
    }
  }, [open])

  return proposals
}

interface SourceProposalsProps {
  topic: TopicSummary
  proposals: SourceProposal[]
  onAdded: (id: string) => void
  onUnauthorized: () => void
}

// "Nos suggestions": well-known sites for a topic, chosen with the app, added in one tap. Their feed is
// found and tried as they are added, as a pasted link's.
const SourceProposals = ({ topic, proposals, onAdded, onUnauthorized }: SourceProposalsProps) => {
  const { t } = useTranslation()
  const [adding, setAdding] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const shown = proposals.filter(proposal => proposal.topicId === topic.id)
  // The sites in the profile's language, then those in the household's when it differs: a profile reading
  // English in a French household is offered both. Other languages are left out; a site in one is still added
  // by link. A separator names a language unless every proposal is in the reader's.
  const language = getLanguage()
  const groups = [...new Set([language, getHouseholdLanguage()])]
    .map(lang => ({ lang, proposals: shown.filter(proposal => proposal.lang === lang) }))
    .filter(group => group.proposals.length > 0)

  const add = async (proposal: SourceProposal) => {
    setAdding(proposal.id)
    setError(null)
    try {
      const outcome = await addProposal(proposal.id, [topic.id])
      if (outcome.ok) {
        setAdded(current => [...current, proposal.id])
        window.dispatchEvent(new Event(TOPICS_CHANGED))
        onAdded(outcome.id)
      } else {
        setError(t(`settings.proposals.errors.${ADD_FAILURES[outcome.error] ?? 'failed'}`))
      }
    } catch (failure) {
      if (failure instanceof UnauthorizedError) onUnauthorized()
      else setError(t('settings.proposals.errors.failed'))
    } finally {
      setAdding(null)
    }
  }

  if (groups.length === 0) return null

  const list = (rows: SourceProposal[]) => (
    <SiteList tone="neutral">
      {rows.map(proposal => (
        <SiteRow
          key={proposal.id}
          name={proposal.name}
          link={proposal.site}
          added={added.includes(proposal.id)}
          adding={adding === proposal.id}
          busy={adding !== null}
          onAdd={() => void add(proposal)}
        />
      ))}
    </SiteList>
  )

  return (
    <div className={styles.box} data-tour="add-sites">
      {groups.map(group => (
        <Fragment key={group.lang}>
          {(groups.length > 1 || group.lang !== language) && (
            <DaySeparator
              label={t(`settings.proposals.inLanguage.${group.lang}`)}
              count={group.proposals.length}
              unit="source"
              still
              className={styles.separator}
            />
          )}
          {list(group.proposals)}
        </Fragment>
      ))}
      {adding && <StatusLine tone="info">{t('settings.proposals.trying')}</StatusLine>}
      {error && <StatusLine tone="error">{error}</StatusLine>}
    </div>
  )
}

export default SourceProposals
