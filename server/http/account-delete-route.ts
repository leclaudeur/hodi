import type express from 'express'
import { clearedProfileCookie, clearedSessionCookie } from '../auth/session.ts'
import type { AccountHelpers, AccountRoutesOptions } from './account-routes.ts'

export const mountDeleteRoute = (
  router: express.Router,
  { data, profiles, now, onDeleteProfile, onAccountDeleted, onHouseholdGone, cookieWithout }: AccountRoutesOptions,
  { sessionOrRefuse, checkProof, plan }: AccountHelpers
) => {
  // "Supprimer ton compte", after its red confirmation and the account's password: at once, with what the plan says
  // goes with it.
  router.delete('/', async (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    if (!profiles) {
      response.status(409).json({ error: 'not_available' })
      return
    }
    if (!(await checkProof(session.account, request, response))) return
    // After the password, which takes a moment: what goes is read as it is now.
    const going = plan(session.account)!
    for (const profile of [...going.profiles, ...going.children]) onDeleteProfile?.(profile.id)
    for (const accountId of data.delete(session.account, going, now())) onAccountDeleted?.(accountId)
    if (going.householdGoes) onHouseholdGone?.()
    const left = cookieWithout ? cookieWithout(session.account.id, request).cookie : clearedSessionCookie()
    response.set('Set-Cookie', [left, clearedProfileCookie()])
    response.status(204).end()
  })
}
