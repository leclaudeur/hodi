import type express from 'express'
import { hashPassword } from '../auth/password.ts'
import type { HouseholdOptions, HouseholdView } from './household-routes.ts'

// Réglages › Foyer › Code parental, the admin's: six digits that open the adults' profiles that are not private. A
// forgotten code is never shown again: the admin types a new one.
export const mountParentalCodeRoutes = (
  router: express.Router,
  { household }: HouseholdOptions,
  view: HouseholdView
) => {
  // On, or a new code: every device asks for it from the next opening.
  router.put('/parental-code', async (request, response) => {
    const code: unknown = request.body?.code
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    household.setParentalCode(await hashPassword(code))
    response.json(view())
  })

  router.delete('/parental-code', (_request, response) => {
    household.setParentalCode(null)
    response.json(view())
  })
}
