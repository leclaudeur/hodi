import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { cleanHandle } from '../../shared/handle.ts'
import { hashPassword } from '../auth/password.ts'
import {
  PROFILE_AVATARS,
  type ProfileAvatar,
  type ProfileStore,
  cleanName,
  profileColorOf
} from '../db/profile-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import type { UserDevice } from '../db/user-device-store.ts'
import { type NewYoungAccount, type YoungAccountStore, type YoungKind } from '../db/young-account-store.ts'
import { isPassword } from './household-input.ts'
import { profileIdOf } from './profile-routes.ts'
import type { CheckProof } from './proof.ts'

// Mon compte › Mes enfants: a parent makes a teen's or a child's account, gives it a new password, and deletes it.
// Only an adult whose own profile is open here, and only for its own children.

export interface YoungAccountRoutesOptions {
  accounts: UserAccountStore
  profiles: ProfileStore
  young: YoungAccountStore
  sessionOf: (request: express.Request) => { account: UserAccount; device: UserDevice | null } | null
  checkProof: CheckProof
  now: () => number
  // A new profile: the plugins and the young one's sources hear of it.
  onCreate?: (profileId: number) => void
  // What else goes with a deleted profile, before it goes.
  onDeleteProfile?: (profileId: number) => void
  onAccountDeleted?: (accountId: number) => void
}

const YOUNG_KINDS: readonly YoungKind[] = ['teen', 'child']

// Each account takes a @username for good and a row: an adult cannot fill the server with them.
export const MAX_CHILDREN = 10
export const CREATES_PER_MINUTE = 5

const isAvatar = (value: unknown): value is ProfileAvatar => PROFILE_AVATARS.includes(value as ProfileAvatar)

// What « Créer un compte » sent, or null when a part of it cannot be.
const newYoungOf = (body: Record<string, unknown>): (NewYoungAccount & { password: string }) | null => {
  const name = cleanName(body.name)
  const color = profileColorOf(body.color)
  const kind = YOUNG_KINDS.find(option => option === body.kind)
  const handle = body.handle === undefined ? null : cleanHandle(body.handle)
  const avatar = body.avatar === undefined ? undefined : isAvatar(body.avatar) ? body.avatar : null
  if (!name || !color || !kind || avatar === null || (body.handle !== undefined && !handle)) return null
  if (!isPassword(body.password)) return null
  return { name, color, kind, avatar, handle, password: body.password }
}

export const youngAccountRoutes = (options: YoungAccountRoutesOptions) => {
  const router = express.Router()
  const { accounts, young } = options

  // The parent asking: its own account, its profile open on this device, an adult's.
  const parentOf = (request: express.Request, response: express.Response) => {
    const session = options.sessionOf(request)
    const own = session ? accounts.profileOf(session.account.id) : null
    if (!session || own === null || own !== profileIdOf(response) || young.isYoung(session.account.id)) {
      response.status(403).json({ error: 'parents_only' })
      return null
    }
    return session.account
  }

  router.get('/', (request, response) => {
    const parent = parentOf(request, response)
    if (parent) response.json({ children: young.childrenOf(parent.id) })
  })

  mountCreateRoute(router, options, parentOf)
  mountChildRoutes(router, options, parentOf)
  return router
}

type ParentOf = (request: express.Request, response: express.Response) => UserAccount | null

const mountCreateRoute = (router: express.Router, options: YoungAccountRoutesOptions, parentOf: ParentOf) => {
  const { accounts, profiles, young, now, onCreate } = options
  const createLimit = rateLimit({
    windowMs: 60_000,
    limit: CREATES_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: request => `young-create:${options.sessionOf(request)?.account.id ?? 'none'}`,
    validate: { xForwardedForHeader: false },
    handler: (_request, response) => {
      response.status(429).json({ error: 'too_many_requests' })
    }
  })
  router.post('/', createLimit, async (request, response) => {
    const parent = parentOf(request, response)
    if (!parent) return
    if (young.childrenOf(parent.id).length >= MAX_CHILDREN) {
      response.status(409).json({ error: 'limit' })
      return
    }
    const asked = newYoungOf((request.body ?? {}) as Record<string, unknown>)
    if (!asked) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (asked.handle && !accounts.isHandleFree(asked.handle, now())) {
      response.status(409).json({ error: 'handle_taken' })
      return
    }
    const passwordHash = await hashPassword(asked.password)
    const child = young.create(profiles, parent.id, { ...asked, passwordHash }, now())
    if (!child) {
      response.status(409).json({ error: 'limit' })
      return
    }
    onCreate?.(child.profileId)
    response.status(201).json(child)
  })
}

const mountChildRoutes = (router: express.Router, options: YoungAccountRoutesOptions, parentOf: ParentOf) => {
  const { accounts, profiles, young, checkProof, now } = options

  // One of the parent's children, after the parent's own password; else the refusal is sent.
  const provenChild = async (request: express.Request, response: express.Response) => {
    const parent = parentOf(request, response)
    if (!parent) return null
    const child = young.childOf(parent.id, Number(request.params.id))
    if (!child) {
      response.status(404).json({ error: 'not_found' })
      return null
    }
    return (await checkProof(parent, request, response)) ? child : null
  }

  // « Nouveau mot de passe »: the young one's devices signed in with the old one sign in again.
  router.put('/:id/password', async (request, response) => {
    const newPassword: unknown = request.body?.newPassword
    if (!isPassword(newPassword)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const child = await provenChild(request, response)
    if (!child) return
    accounts.setPassword(child.accountId, await hashPassword(newPassword), now())
    response.json(young.childOf(parentOf(request, response)!.id, child.accountId))
  })

  // « Supprimer », after its red confirmation: the account, its profile and all it read go.
  router.delete('/:id', async (request, response) => {
    const child = await provenChild(request, response)
    if (!child) return
    options.onDeleteProfile?.(child.profileId)
    young.delete(profiles, child)
    options.onAccountDeleted?.(child.accountId)
    response.status(204).end()
  })
}
