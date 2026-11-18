import type express from 'express'
import type { AccountHelpers, AccountRoutesOptions } from './account-routes.ts'

// Réglages › Compte et données: « Profil privé » and the devices that open it without the password.
export const mountLockRoutes = (
  router: express.Router,
  { accounts, devices }: AccountRoutesOptions,
  { sessionOrRefuse, recentlySignedIn, checkProof, view }: AccountHelpers
) => {
  // On, with the password (and the app's code): it is the one « Qui lit ? » asks from then on, so a person who no
  // longer knows it does not shut their own profile. Off, at once, from the profile already open.
  router.put('/private', async (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    const on: unknown = request.body?.on
    if (typeof on !== 'boolean') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    // An account with no password of its own (« Se connecter avec Google ») proves it by a sign-in a moment ago.
    const signedInNow = !session.account.hasPassword && recentlySignedIn(session.device)
    const proved = !on || signedInNow || (await checkProof(session.account, request, response))
    if (!proved) return
    accounts.setPrivateProfile(session.account.id, on)
    response.json(view(accounts.get(session.account.id)!, session.device))
  })

  // « Redemander »: no device of the account opens its profile without the password any more.
  router.delete('/trusted', (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    devices.untrustAll(session.account.id)
    response.json(view(session.account, session.device))
  })
}
