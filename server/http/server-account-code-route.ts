import type express from 'express'
import { type ProfileStore, isYoung } from '../db/profile-store.ts'
import type { ServerPeopleStore } from '../db/server-people-store.ts'
import type { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { profileIdOf } from './profile-routes.ts'

interface AccountCodeOptions {
  people?: ServerPeopleStore
  codes?: SignInCodeStore
  profiles?: ProfileStore
  codeRequests?: { askedAt: (accountId: number) => number | null; handled: (accountId: number) => void }
  now: () => number
}

interface AccountCodeHelpers {
  createdByOf: (response: express.Response) => number | null
  proven: (request: express.Request, response: express.Response) => Promise<boolean>
}

export const mountAccountCodeRoute = (
  router: express.Router,
  { people, codes, profiles, codeRequests, now }: AccountCodeOptions,
  { createdByOf, proven }: AccountCodeHelpers
) => {
  if (!people || !codes || !profiles) return
  // "Mot de passe oublié" for an adult's account: a code that lets that person choose a new password, only once they
  // asked for one, so the admin cannot take an account over on their own. One's own password changes in My account.
  router.post('/accounts/:id/code', async (request, response) => {
    const account = people.accounts().find(entry => entry.id === Number(request.params.id))
    const profile = account?.profile ? profiles.get(account.profile.id) : null
    if (!account || !profile || isYoung(profile)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (profile.id === profileIdOf(response)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (codeRequests && codeRequests.askedAt(account.id) === null) {
      response.status(409).json({ error: 'not_asked' })
      return
    }
    if (!(await proven(request, response))) return
    const made = codes.create({ profileId: profile.id, createdBy: createdByOf(response), reset: true }, now())
    codeRequests?.handled(account.id)
    response.status(201).json(made)
  })
}
