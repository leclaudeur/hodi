import express from 'express'
import type { UserStore } from '../db/user-store.ts'

interface MySourcesRoutesOptions {
  users: (response: express.Response) => UserStore
  // A source of the server's catalogue, the only ones a person adds by id.
  listed: (id: string) => boolean
  // What a teen's or a child's parents keep off: never theirs to add.
  lock: (response: express.Response) => { hiddenSources: string[] } | null
  now: () => number
}

// « Mes sources »: a source of the catalogue in a person's list, or out of it. The new state reaches their devices.
export const mySourcesRoutes = ({ users, listed, lock, now }: MySourcesRoutesOptions) => {
  const router = express.Router()

  router.put('/:id', (request, response) => {
    const id = request.params.id
    if (!listed(id) || lock(response)?.hiddenSources.includes(id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    response.json({ revision: users(response).sources.add([id], now()) })
  })

  router.delete('/:id', (request, response) => {
    response.json({ revision: users(response).sources.remove(request.params.id, now()) })
  })

  return router
}
