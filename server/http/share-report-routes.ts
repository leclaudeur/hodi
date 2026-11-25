import express from 'express'
import { type ShareReportStore, isShareReportReason } from '../db/share-report-store.ts'
import { idParam } from './id-param.ts'

interface ShareReportOptions {
  reports: ShareReportStore
  // The account reading, the one the report counts for; null: no account reads here.
  accountOf: (response: express.Response) => number | null
  profileOf: (response: express.Response) => number
  // À traiter hears of it.
  onReported: (id: number) => void
  now: () => number
}

const REFUSALS = { not_found: 404, already: 409, too_many: 429 } as const

// « Signaler ce partage »: a share this profile received, with a reason; nothing happens to its sender until the
// server's admin decides.
export const shareReportRoutes = ({ reports, accountOf, profileOf, onReported, now }: ShareReportOptions) => {
  const router = express.Router()
  router.post('/me/shares/report', (request, response) => {
    const accountId = accountOf(response)
    const { articleId, from, reason } = (request.body ?? {}) as Record<string, unknown>
    if (accountId === null) {
      response.status(403).json({ error: 'account_only' })
      return
    }
    if (typeof articleId !== 'string' || !Number.isInteger(from) || !isShareReportReason(reason)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const share = { profileId: profileOf(response), fromProfile: from as number, articleId }
    const outcome = reports.report(share, accountId, reason, now())
    if (typeof outcome === 'string') {
      response.status(REFUSALS[outcome]).json({ error: outcome })
      return
    }
    onReported(outcome.id)
    response.status(204).end()
  })
  return router
}

interface ShareDecisionOptions {
  reports: ShareReportStore
  // It leaves À traiter.
  onDecided: (id: number) => void
  now: () => number
}

// À traiter's reported shares, for the server's admin: the share and its sender, never who reported it. Ignorer is the
// only decision here: the sender's account is blocked or deleted from its own page.
export const shareDecisionRoutes = ({ reports, onDecided, now }: ShareDecisionOptions) => {
  const router = express.Router()
  router.get('/', (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({ reports: reports.all() })
  })
  router.post('/:id', (request, response) => {
    const id = idParam(request.params.id)
    if (request.body?.decision !== 'ignore') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!Number.isInteger(id) || !reports.handle(id, now())) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    onDecided(id)
    response.status(204).end()
  })
  return router
}
