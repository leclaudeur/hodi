import type express from 'express'
import { clearedProfileCookie } from '../auth/session.ts'
import type { AccountHelpers, AccountRoutesOptions } from './account-routes.ts'

// Mon compte › Foyer › « Quitter », after its red confirmation and the account's password: the person's profile and
// what it read and kept go, the account stays and can join another household with a code. Never the last adult with
// an account, whose household no one could open any more: deleting the account is that way out.
export const mountLeaveRoute = (
  router: express.Router,
  { data, profiles, now, onDeleteProfile }: AccountRoutesOptions,
  { sessionOrRefuse, checkProof, plan }: AccountHelpers
) => {
  router.post('/leave', async (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    if (!profiles) {
      response.status(409).json({ error: 'not_available' })
      return
    }
    const refusal = refusalOf(plan(session.account)!)
    if (refusal) {
      response.status(409).json({ error: refusal })
      return
    }
    if (!(await checkProof(session.account, request, response))) return
    // After the password, which takes a moment: what goes is read as it is now.
    const going = plan(session.account)!
    if (refusalOf(going)) {
      response.status(409).json({ error: refusalOf(going) })
      return
    }
    for (const profile of going.profiles) onDeleteProfile?.(profile.id)
    data.leave(session.account, going, now())
    response.set('Set-Cookie', clearedProfileCookie())
    response.status(204).end()
  })
}

const refusalOf = (going: { householdGoes: boolean; profiles: unknown[] }) => {
  if (going.profiles.length === 0) return 'no_household'
  if (going.householdGoes) return 'last_adult'
  return null
}
