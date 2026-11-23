import { useCallback, useEffect, useState } from 'react'
import {
  type InboxItem,
  type ShareReportView,
  type SourceReportView,
  type SourceReview,
  getServerInbox,
  getShareReports,
  getSourceReports,
  getSourceReviews
} from '../../../api.ts'
import { sortInbox } from '../../../lib/server-inbox.ts'

const CHANGED = 'hodi:inbox-changed'

// A decision taken: the list and the open item load again.
export const inboxChanged = () => window.dispatchEvent(new Event(CHANGED))

interface Inbox {
  items: InboxItem[] | null
  // The sources still waiting for a decision.
  reviews: SourceReview[]
  // The sources reported, until the admin decides.
  reports: SourceReportView[]
  // The shares reported, until the admin ignores them.
  shares: ShareReportView[]
  failed: boolean
}

// À traiter's items, the requests still waiting first, and what they are about: sources to judge or reported, shares
// reported.
export const useInbox = () => {
  const [inbox, setInbox] = useState<Inbox>({ items: null, reviews: [], reports: [], shares: [], failed: false })
  const load = useCallback(() => {
    Promise.all([
      getServerInbox(),
      getSourceReviews().catch(() => ({ validating: false, sources: [] })),
      getSourceReports().catch(() => ({ reports: [] })),
      getShareReports().catch(() => ({ reports: [] }))
    ])
      .then(([answer, reviews, reported, shares]) =>
        setInbox({
          items: sortInbox(answer.items),
          reviews: reviews.sources,
          reports: reported.reports,
          shares: shares.reports,
          failed: false
        })
      )
      .catch(() => setInbox(current => ({ ...current, items: current.items ?? [], failed: true })))
  }, [])
  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])
  return inbox
}
