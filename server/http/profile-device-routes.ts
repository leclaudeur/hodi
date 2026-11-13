import express from 'express'
import { type ProfileStore, isYoung } from '../db/profile-store.ts'
import type { ProfileDeviceStore } from '../db/profile-device-store.ts'
import { isParentOf } from './profile-routes.ts'

interface ProfileDeviceRoutesOptions {
  devices: ProfileDeviceStore
  profiles: ProfileStore
  now: () => number
}

// Réglages > Profils > a young profile > Appareils: its own devices, which any adult of the household sees and
// removes. A removed device asks for a new code.
export const profileDeviceRoutes = ({ devices, profiles, now }: ProfileDeviceRoutesOptions) => {
  const router = express.Router()

  // The young profile the request is about, when the profile asking is one of its parents.
  const youngOf = (request: express.Request, response: express.Response) => {
    const id = Number(request.params.id)
    const target = Number.isInteger(id) ? profiles.get(id) : null
    if (!target || !isYoung(target)) {
      response.status(404).json({ error: 'not_found' })
      return null
    }
    if (response.locals.profileChosen !== true || response.locals.linkedDevice === true || !isParentOf(response)) {
      response.status(403).json({ error: 'adults_only' })
      return null
    }
    return target
  }

  router.get('/:id/devices', (request, response) => {
    const target = youngOf(request, response)
    if (!target) return
    response.json({
      devices: devices.list(target.id, now()).map(({ id, userAgent, lastSeenAt }) => ({ id, userAgent, lastSeenAt }))
    })
  })

  router.delete('/:id/devices/:device', (request, response) => {
    const target = youngOf(request, response)
    if (!target) return
    if (!devices.delete(target.id, Number(request.params.device))) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    response.status(204).end()
  })

  return router
}
