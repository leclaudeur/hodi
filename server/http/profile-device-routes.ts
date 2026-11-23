import express from 'express'
import { type ProfileStore, isYoung } from '../db/profile-store.ts'
import type { ProfileDeviceStore } from '../db/profile-device-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import type { UserDeviceStore } from '../db/user-device-store.ts'
import { isParentOfYoung } from './parent-check.ts'

interface ProfileDeviceRoutesOptions {
  devices: ProfileDeviceStore
  profiles: ProfileStore
  accounts?: UserAccountStore
  // The devices its own account signed in on, with its @identifier and password.
  accountDevices?: UserDeviceStore
  now: () => number
}

// A young one's card › Appareils: its own devices, which its parents see and remove: those its account signed in on,
// and those linked with a parent's code before. A removed device asks to sign in again.
export const profileDeviceRoutes = ({
  devices,
  profiles,
  accounts,
  accountDevices,
  now
}: ProfileDeviceRoutesOptions) => {
  const router = express.Router()

  // The young profile the request is about, when the profile asking is one of its parents.
  const youngOf = (request: express.Request, response: express.Response) => {
    const id = Number(request.params.id)
    const target = Number.isInteger(id) ? profiles.get(id) : null
    if (!target || !isYoung(target)) {
      response.status(404).json({ error: 'not_found' })
      return null
    }
    if (
      response.locals.profileChosen !== true ||
      response.locals.linkedDevice === true ||
      !isParentOfYoung(response, accounts, target)
    ) {
      response.status(403).json({ error: 'adults_only' })
      return null
    }
    return target
  }

  router.get('/:id/devices', (request, response) => {
    const target = youngOf(request, response)
    if (!target) return
    const account = accounts?.ofProfile(target.id)
    const signedIn = account && accountDevices ? accountDevices.list(account.id) : []
    response.json({
      devices: [
        ...signedIn.map(({ id, userAgent, lastSeenAt }) => ({ id, kind: 'account', userAgent, lastSeenAt })),
        ...devices
          .list(target.id, now())
          .map(({ id, userAgent, lastSeenAt }) => ({ id, kind: 'linked', userAgent, lastSeenAt }))
      ]
    })
  })

  // A device its account signed in on: signed out, as from its own Mon compte.
  router.delete('/:id/account-devices/:device', (request, response) => {
    const target = youngOf(request, response)
    if (!target) return
    const account = accounts?.ofProfile(target.id)
    if (!account || !accountDevices?.delete(account.id, Number(request.params.device))) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    response.status(204).end()
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
