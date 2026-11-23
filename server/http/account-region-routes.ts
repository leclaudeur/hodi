import type express from 'express'
import type { AccountHelpers, AccountRoutesOptions } from './account-routes.ts'
import { countryOf, timeZoneOf } from './household-input.ts'

// Réglages › Mon compte › Région: the person's time zone and country, wherever they read.
export const mountRegionRoutes = (
  router: express.Router,
  { accounts }: AccountRoutesOptions,
  { sessionOrRefuse, view }: AccountHelpers
) => {
  router.put('/region', (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    const body = (request.body ?? {}) as { timeZone?: unknown; country?: unknown }
    const timeZone = timeZoneOf(body.timeZone)
    const country = countryOf(body.country)
    // A time zone can change but not go: every day needs one.
    if (timeZone === false || timeZone === null || country === false || (timeZone ?? country) === undefined) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    accounts.setRegion(session.account.id, { timeZone, country })
    response.json(view(accounts.get(session.account.id)!, session.device))
  })
}
