import type express from 'express'
import { cleanHandle } from '../../shared/handle.ts'
import type { UserAccount } from '../db/user-account-store.ts'
import { MAX_PARENTS } from '../db/parent-invitation-store.ts'
import type { YoungAccountRoutesOptions } from './young-account-routes.ts'

type ParentOf = (request: express.Request, response: express.Response) => UserAccount | null

// The young one's card › Parents: « Inviter un parent » by its @identifier, its answer, and « Ne plus être parent ».
// Both parents have the same rights, and neither can take the other off: in a separation, no parent cuts the other
// off from their child.
export const mountParentRoutes = (
  router: express.Router,
  options: YoungAccountRoutesOptions,
  parentOf: ParentOf,
  limit: express.RequestHandler
) => {
  const { accounts, young, checkProof, now } = options
  const invitations = young.invitations

  // One of the asking parent's children, or the refusal sent.
  const ownChild = (request: express.Request, response: express.Response) => {
    const parent = parentOf(request, response)
    if (!parent) return null
    const child = young.childOf(parent.id, Number(request.params.id))
    if (!child) response.status(404).json({ error: 'not_found' })
    return child && { parent, child }
  }

  // An adult who has an account on the server, not yet its parent: it is asked, and answers in its own Mes enfants.
  router.post('/:id/parents', limit, (request, response) => {
    const asking = ownChild(request, response)
    if (!asking) return
    const handle = cleanHandle(String(request.body?.handle ?? '').replace(/^@/, ''))
    const invited = handle ? accounts.byHandle(handle) : null
    if (!invited || invited.email === null || young.isYoung(invited.id)) {
      response.status(404).json({ error: 'unknown_handle' })
      return
    }
    const parents = invitations.parentsOf(asking.child.accountId)
    if (parents.includes(invited.id)) {
      response.status(409).json({ error: 'already_parent' })
      return
    }
    if (parents.length >= MAX_PARENTS) {
      response.status(409).json({ error: 'parents_full' })
      return
    }
    invitations.invite(asking.child.accountId, asking.parent.id, invited.id, now())
    response.status(201).json(young.childOf(asking.parent.id, asking.child.accountId))
  })

  // Its parent takes the invitation back before it is answered.
  router.delete('/:id/parents/invitation', (request, response) => {
    const asking = ownChild(request, response)
    if (!asking) return
    invitations.cancel(asking.child.accountId)
    response.json(young.childOf(asking.parent.id, asking.child.accountId))
  })

  // « Ne plus être parent », after the parent's own password. The last one deletes the account instead.
  router.delete('/:id/parents/me', async (request, response) => {
    const asking = ownChild(request, response)
    if (!asking || !(await checkProof(asking.parent, request, response))) return
    if (!invitations.leave(asking.parent.id, asking.child.accountId)) {
      response.status(409).json({ error: 'last_parent' })
      return
    }
    response.status(204).end()
  })

  // The invited adult's « Accepter »: the young one is theirs too, with the same rights.
  router.post('/invitations/:childId', (request, response) => {
    const parent = parentOf(request, response)
    if (!parent) return
    const childId = Number(request.params.childId)
    const answer = invitations.accept(parent.id, childId, now())
    if (answer !== 'accepted') {
      response.status(answer === 'full' ? 409 : 404).json({ error: answer === 'full' ? 'parents_full' : 'not_found' })
      return
    }
    response.json(young.childOf(parent.id, childId))
  })

  // « Refuser »: nothing changes.
  router.delete('/invitations/:childId', (request, response) => {
    const parent = parentOf(request, response)
    if (!parent) return
    if (invitations.refuse(parent.id, Number(request.params.childId))) response.status(204).end()
    else response.status(404).json({ error: 'not_found' })
  })
}
