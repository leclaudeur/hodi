import type express from 'express'
import { hashPassword } from '../auth/password.ts'
import { profileCookie, profileToken } from '../auth/session.ts'
import type { HouseholdOptions, HouseholdView } from './household-routes.ts'
import { profileIdOf } from './profile-routes.ts'

// Réglages › Foyer › Code parental, the admin's: six digits that open the adults' profiles that are not private. A
// forgotten code is never shown again: the admin types a new one.
export const mountParentalCodeRoutes = (
  router: express.Router,
  { household, profiles, secret }: HouseholdOptions,
  view: HouseholdView
) => {
  // Every device asks for the new code, but the admin's profile stays open on the one that typed it.
  const keepOpen = (response: express.Response) => {
    const id = profileIdOf(response)
    response.set('Set-Cookie', profileCookie(profileToken(id, profiles.lock(id)?.version ?? 0, secret)))
  }

  // On, or a new code: every device asks for it from the next opening.
  router.put('/parental-code', async (request, response) => {
    const code: unknown = request.body?.code
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    household.setParentalCode(await hashPassword(code))
    keepOpen(response)
    response.json(view())
  })

  router.delete('/parental-code', (_request, response) => {
    household.setParentalCode(null)
    keepOpen(response)
    response.json(view())
  })
}
