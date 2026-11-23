import express from 'express'
import type { SourceReportStore } from '../db/source-report-store.ts'
import { isReportReason } from '../db/source-report-store.ts'
import type { SourceReviewStore } from '../db/source-review-store.ts'
import type { NewsService } from '../news/news-service.ts'
import { CONFIG } from '../fixed-config.ts'

interface ReportRoutesOptions {
  reports: SourceReportStore
  news: NewsService
  // The account asking, the only one a report counts for; null: no account reads here.
  accountOf: (response: express.Response) => number | null
  // Whether the person asking sees this source: one waiting in À traiter or refused is not said to exist to the others.
  visible?: (response: express.Response, sourceId: string) => boolean
  // The first report since the admin's last decision: À traiter hears of it.
  onFirst: (source: { id: string; name: string }) => void
  now: () => number
}

// Far above what a person reports, far below one account reporting the whole catalogue, a notice each.
export const REPORTS_PER_HOUR = CONFIG.sources.reportsPerHour
const HOUR_MS = 60 * 60 * 1000

// Each account's reports of the last hour.
const reportLimit = (now: () => number) => {
  const recent = new Map<number, number[]>()
  return (accountId: number) => {
    const since = now() - HOUR_MS
    const times = (recent.get(accountId) ?? []).filter(at => at > since)
    const allowed = times.length < REPORTS_PER_HOUR
    if (allowed) times.push(now())
    recent.set(accountId, times)
    return allowed
  }
}

const sourceOf = (news: NewsService, id: string) =>
  news.getSourceStatuses().find(candidate => candidate.id === id) ?? null

// « Signaler »: any account, about any source it can see, with a reason. Reporting again only changes the reason.
export const sourceReportRoutes = ({ reports, news, accountOf, visible, onFirst, now }: ReportRoutesOptions) => {
  const router = express.Router()
  const allowed = reportLimit(now)
  router.post('/:id/report', (request, response) => {
    const accountId = accountOf(response)
    const found = sourceOf(news, request.params.id)
    const source = found && (visible?.(response, found.id) ?? true) ? found : null
    const reason: unknown = request.body?.reason
    if (accountId === null) {
      response.status(403).json({ error: 'account_only' })
      return
    }
    if (!source) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!isReportReason(reason)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!allowed(accountId)) {
      response.status(429).json({ error: 'too_many_requests' })
      return
    }
    if (reports.report(source.id, accountId, reason, now())) onFirst(source)
    response.status(204).end()
  })
  return router
}

interface ReportDecisionOptions {
  reports: SourceReportStore
  reviews: SourceReviewStore
  news: NewsService
  // Out of the catalogue: everyone's lists hear of one less to add.
  onUnlisted: (sourceId: string) => void
  // It leaves À traiter.
  onDecided: (sourceId: string) => void
  now: () => number
}

// À traiter's reports, for the server's admin: how many and why, never who. Ignorer keeps the source, and those who
// reported it are not heard on it for a while; Retirer du catalogue takes it out for everyone who does not read it
// yet, and its reports go.
export const reportDecisionRoutes = ({ reports, reviews, news, onUnlisted, onDecided, now }: ReportDecisionOptions) => {
  const router = express.Router()

  router.get('/', (_request, response) => {
    const listed = reports.all().flatMap(summary => {
      const source = sourceOf(news, summary.sourceId)
      if (!source) return []
      const { id, name, site, kind, lang, description } = source
      return [{ id, name, site, kind, lang, description: description ?? null, ...summary }]
    })
    response.set('Cache-Control', 'no-store')
    response.json({ reports: listed })
  })

  router.post('/:id', (request, response) => {
    const id = request.params.id
    const decision: unknown = request.body?.decision
    if (!reports.get(id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (decision !== 'ignore' && decision !== 'unlist') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (decision === 'ignore') reports.ignore(id, now())
    else {
      reports.clear(id)
      reviews.unlist(id, now())
      onUnlisted(id)
    }
    onDecided(id)
    response.status(204).end()
  })

  return router
}
