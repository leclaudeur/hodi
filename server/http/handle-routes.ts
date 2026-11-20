import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { cleanHandle } from '../../shared/handle.ts'
import type { HandleStore } from '../db/handle-store.ts'
import type { UserAccount } from '../db/user-account-store.ts'

// How many identifiers a client may check in a minute, typing included.
const CHECKS_PER_MINUTE = 60

type SessionOf = (request: express.Request) => { account: UserAccount } | null

interface HandleRoutesOptions {
  handles: HandleStore
  sessionOf: SessionOf
  now: () => number
}

// "Identifiant", as it is typed: free, or taken and a free one like it. Before any sign-in too, for the first-run
// screens and a code's new account; identifiers are public anyway, for friends.
export const handleCheckRoutes = ({ handles, sessionOf, now }: HandleRoutesOptions) => {
  const router = express.Router()
  const limit = rateLimit({
    windowMs: 60_000,
    limit: CHECKS_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (_request, response) => {
      response.status(429).json({ error: 'too_many_requests' })
    }
  })
  router.get('/:handle', limit, (request, response) => {
    const handle = cleanHandle(request.params.handle)
    if (!handle) {
      response.status(400).json({ error: 'bad_handle' })
      return
    }
    const self = sessionOf(request)?.account.id ?? null
    const free = handles.isFree(handle, now(), self)
    response.json({ free, suggestion: free ? null : handles.suggest(handle, now(), self) })
  })
  return router
}

// Mon compte › « Modifier »: a new identifier, once every 30 days.
export const accountHandleRoutes = ({ handles, sessionOf, now }: HandleRoutesOptions) => {
  const router = express.Router()
  router.put('/', (request, response) => {
    const session = sessionOf(request)
    if (!session) {
      response.status(401).json({ error: 'unauthenticated' })
      return
    }
    const handle = cleanHandle((request.body as Record<string, unknown> | undefined)?.handle)
    if (!handle) {
      response.status(400).json({ error: 'bad_handle' })
      return
    }
    const id = session.account.id
    const change = handles.change(id, handle, now())
    if (change === 'too_soon') {
      response.status(409).json({ error: 'too_soon', changeableFrom: handles.changeableFrom(id, now()) })
      return
    }
    if (change === 'taken') {
      response.status(409).json({ error: 'handle_taken', suggestion: handles.suggest(handle, now(), id) })
      return
    }
    response.json({ handle, changeableFrom: handles.changeableFrom(id, now()) })
  })
  return router
}
