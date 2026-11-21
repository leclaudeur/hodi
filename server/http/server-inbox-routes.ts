import express from 'express'
import type { ServerInboxStore } from '../db/server-inbox-store.ts'

// Serveur › À traiter: the requests, newest first, and how many still wait (the sidebar's count).
export const serverInboxRoutes = (inbox: ServerInboxStore, now: () => number = Date.now) => {
  const router = express.Router()
  router.get('/', (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({ items: inbox.list(now()), waiting: inbox.waitingAll().size })
  })
  return router
}
