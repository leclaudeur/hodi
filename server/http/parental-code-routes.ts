import type express from 'express'
import { hashPassword } from '../auth/password.ts'
import { profileCookie, profileToken } from '../auth/session.ts'
import type { HouseholdOptions, HouseholdView } from './household-routes.ts'
import { profileIdOf } from './profile-routes.ts'
import { accountAsking } from './proof.ts'

// Réglages › Foyer › Code parental, the admin's: six digits that open the adults' profiles that are not private. A
// forgotten code is never shown again: the admin types a new one, with their own password (and the app's code), as
// a profile left open on a shared device does not prove who changes it.
export const mountParentalCodeRoutes = (
  router: express.Router,
  { household, profiles, secret, accounts, checkProof }: HouseholdOptions,
  view: HouseholdView
) => {
  // false when the refusal was sent. The body's code is the new Code parental: the app's code comes as appCode.
  const proven = async (request: express.Request, response: express.Response) => {
    if (!accounts || !checkProof) return true
    const account = accountAsking(response, accounts)
    if (!account) {
      response.status(403).json({ error: 'account_only' })
      return false
    }
    const body = request.body as { password?: unknown; appCode?: unknown } | undefined
    // Never undefined: checkProof would read the body's code, the new Code parental.
    return checkProof(account, request, response, body?.password, body?.appCode ?? '')
  }

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
    if (!(await proven(request, response))) return
    household.setParentalCode(await hashPassword(code))
    keepOpen(response)
    response.json(view())
  })

  router.delete('/parental-code', async (request, response) => {
    if (!(await proven(request, response))) return
    household.setParentalCode(null)
    keepOpen(response)
    response.json(view())
  })
}
