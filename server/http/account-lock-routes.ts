import type express from 'express'
import { hashPassword } from '../auth/password.ts'
import type { AccountHelpers, AccountRoutesOptions } from './account-routes.ts'

// Mon compte: « Profil privé », the devices that open it without the password, and the parent's Code parental.
export const mountLockRoutes = (
  router: express.Router,
  { accounts, devices, profileCookieFor }: AccountRoutesOptions,
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
    // Every other device asks for the password (or the Code parental) from now on; its profile stays open here.
    const own = accounts.profileOf(session.account.id)
    if (own !== null && profileCookieFor) response.set('Set-Cookie', profileCookieFor(own))
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

// Mon compte › Mes enfants › Code parental: six digits an adult's profile asks for, on a device where a teen or a child
// is signed in. Any adult may set one, not only a parent: a grandparent's profile on the teen's tablet keeps its
// Enregistrés and Historique to itself too. A forgotten code is never shown again: the adult types a new one, with
// their password (and the app's code), as a profile left open on a shared tablet does not prove who changes it.
export const mountParentalCodeRoutes = (
  router: express.Router,
  { accounts, profileCookieFor }: AccountRoutesOptions,
  { sessionOrRefuse, checkProof, view }: AccountHelpers
) => {
  // The account, once its password proves it; null when the refusal was sent. The body's code is the new Code
  // parental, so the app's code comes as appCode and is never left undefined.
  const proven = async (request: express.Request, response: express.Response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return null
    const body = request.body as { password?: unknown; appCode?: unknown } | undefined
    const proved = await checkProof(session.account, request, response, body?.password, body?.appCode ?? '')
    return proved ? session : null
  }

  // The other devices ask for the new code; the parent's profile stays open on the one that typed it.
  const done = (response: express.Response, session: NonNullable<ReturnType<typeof sessionOrRefuse>>) => {
    const own = accounts.profileOf(session.account.id)
    if (own !== null && profileCookieFor) response.set('Set-Cookie', profileCookieFor(own))
    response.json(view(accounts.get(session.account.id)!, session.device))
  }

  router.put('/parental-code', async (request, response) => {
    const code: unknown = request.body?.code
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const session = await proven(request, response)
    if (!session) return
    accounts.setParentalCode(session.account.id, await hashPassword(code))
    done(response, session)
  })

  router.delete('/parental-code', async (request, response) => {
    const session = await proven(request, response)
    if (!session) return
    accounts.setParentalCode(session.account.id, null)
    done(response, session)
  })
}
