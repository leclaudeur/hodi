import type express from 'express'
import { deletionPlan } from '../db/account-data.ts'
import { type UserAccount, cleanEmail } from '../db/user-account-store.ts'
import type { ServerHelpers, ServerRoutesOptions } from './server-routes.ts'
import { idParam } from './id-param.ts'

// Serveur › Comptes: what goes for good, each after the server admin's own password.

// An account gone from the server: its profile, or everything with the last adult who has an account, then the
// account and its devices. blocks: its e-mail makes no account again.
// null when the routes have nothing to delete with (tests without accounts).
export const accountRemover = ({ people, accounts, profiles, deletions, now }: ServerRoutesOptions) => {
  if (!people || !accounts || !profiles || !deletions) return null
  const { data, onProfileDeleted, onAccountDeleted } = deletions
  return (account: UserAccount, blocks: boolean) => {
    if (blocks && account.email) accounts.blockEmail(account.email, now())
    const plan = deletionPlan(account, accounts, profiles)
    ;[...plan.profiles, ...plan.children].forEach(profile => onProfileDeleted(profile.id))
    data.deleteFromServer(account, plan, now()).forEach(onAccountDeleted)
  }
}

export const mountDeletionRoutes = (
  router: express.Router,
  options: ServerRoutesOptions,
  { proven }: ServerHelpers
) => {
  const { people, accounts, profiles, deletions } = options
  const removeAccount = accountRemover(options)
  if (!people || !accounts || !profiles || !deletions || !removeAccount) return

  // « Supprimer » an account, never the server's admin's own: Compte et données. « Bloquer » does the same and keeps
  // its e-mail from making an account again.
  const remove = (blocks: boolean) => async (request: express.Request, response: express.Response) => {
    const account = accounts.get(idParam(request.params.id))
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

  // « Nommer admin du serveur »: an adult with a profile, chosen by an admin with their own password. The only way
  // one becomes it, so that the last admin can leave (account-delete-route.ts).
  router.post('/accounts/:id/server-admin', async (request, response) => {
    const account = accounts.get(idParam(request.params.id))
    const profileId = account ? accounts.profileOf(account.id) : null
    const profile = profileId === null ? null : profiles.find(profileId)
    if (!account || !profile) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (account.serverAdmin || profile.kind !== 'adult' || account.suspendedBy) {
      response.status(409).json({ error: 'not_allowed' })
      return
    }
    if (!(await proven(request, response))) return
    accounts.makeServerAdmin(account.id)
    response.status(204).end()
  })

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
}
