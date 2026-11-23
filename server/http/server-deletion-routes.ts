import type express from 'express'
import { deletionPlan } from '../db/account-data.ts'
import { inHousehold } from '../db/household-scope.ts'
import { type UserAccount, cleanEmail } from '../db/user-account-store.ts'
import type { ServerHelpers, ServerRoutesOptions } from './server-routes.ts'

// Serveur › Comptes and Foyers: what goes for good, each after the server admin's own password.

// An account gone from the server: its profile in each household it reads in, or the whole household with its last
// adult who has an account, then the account and its devices. blocks: its e-mail makes no account again.
// null when the routes have nothing to delete with (tests without accounts).
export const accountRemover = ({ people, accounts, profiles, household, deletions, now }: ServerRoutesOptions) => {
  if (!people || !accounts || !profiles || !household || !deletions) return null
  const { data, onProfileDeleted, onAccountDeleted, onHouseholdGone } = deletions
  return (account: UserAccount, blocks: boolean) => {
    if (blocks && account.email) accounts.blockEmail(account.email, now())
    const names = new Map(people.households().map(entry => [entry.id, entry.name]))
    const plans = data.householdsOf(account.id).map(householdId => ({
      householdId,
      plan: inHousehold(householdId, () =>
        deletionPlan(account, accounts, profiles, names.get(householdId) ?? '', householdId)
      )
    }))
    for (const { householdId, plan } of plans)
      inHousehold(householdId, () =>
        [...plan.profiles, ...plan.children].forEach(profile => onProfileDeleted(profile.id))
      )
    const { accounts: gone, households } = data.deleteFromServer(account, plans, now())
    gone.forEach(onAccountDeleted)
    households.forEach(onHouseholdGone)
  }
}

export const mountDeletionRoutes = (
  router: express.Router,
  options: ServerRoutesOptions,
  { proven }: ServerHelpers
) => {
  const { people, accounts, profiles, deletions, now } = options
  const removeAccount = accountRemover(options)
  if (!people || !accounts || !profiles || !deletions || !removeAccount) return
  const { data, onProfileDeleted, onAccountDeleted, onHouseholdGone } = deletions

  // « Supprimer » an account, never the server's admin's own: Compte et données. « Bloquer » does the same and keeps
  // its e-mail from making an account again.
  const remove = (blocks: boolean) => async (request: express.Request, response: express.Response) => {
    const account = accounts.get(Number(request.params.id))
    if (!account) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (account.serverAdmin) {
      response.status(403).json({ error: 'server_admin' })
      return
    }
    if (!(await proven(request, response))) return
    // After the password, which takes a moment: what goes is read as it is now.
    removeAccount(accounts.get(account.id) ?? account, blocks)
    response.status(204).end()
  }
  router.delete('/accounts/:id', remove(false))
  router.post('/accounts/:id/block', remove(true))

  // « Débloquer une adresse »: a block made by mistake. The address is typed, as the server no longer has it.
  router.post('/accounts/unblock', async (request, response) => {
    const email = cleanEmail(request.body?.email)
    if (!email) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!(await proven(request, response))) return
    response.status(accounts.unblockEmail(email) ? 204 : 404).end()
  })

  // « Supprimer » a household: its profiles and all they read and kept, and the accounts that read nowhere else.
  router.delete('/households/:id', async (request, response) => {
    const id = Number(request.params.id)
    if (!people.households().some(entry => entry.id === id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!(await proven(request, response))) return
    inHousehold(id, () => profiles.list().forEach(profile => onProfileDeleted(profile.id)))
    data.deleteHousehold(id, now()).forEach(onAccountDeleted)
    onHouseholdGone(id)
    response.status(204).end()
  })
}
