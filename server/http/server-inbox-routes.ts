import express from 'express'
import type { ServerInboxStore } from '../db/server-inbox-store.ts'

// Serveur › Notifications: what the server told its admins, newest first, and how many requests still wait (the
// sidebar's count).
export const serverInboxRoutes = (inbox: ServerInboxStore) => {
  const router = express.Router()
  router.get('/', (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({ items: inbox.list(), waiting: inbox.waitingAll().size })
  })
  return router
}
