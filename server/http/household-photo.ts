import express from 'express'
import { inHousehold } from '../db/household-scope.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'

// A household's photo, for whoever the caller checked may see it: its people (« Quel foyer ? », Réglages › Foyer)
// and the server's admin (Serveur › Foyers). ?v=<photoVersion>: a new photo has a new address, so each one is kept by
// the browser for good.
export const sendHouseholdPhoto = (
  household: HouseholdStore,
  id: number,
  request: express.Request,
  response: express.Response
) => {
  const ids = household.ids()
  const photo = Number.isInteger(id) && ids.includes(id) ? inHousehold(id, () => household.photo()) : null
  if (!photo) {
    response.status(404).json({ error: 'not_found' })
    return
  }
  response.set('Content-Type', photo.type)
  response.set('Cache-Control', request.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache')
  response.send(photo.data)
}

export const householdPhotoRoutes = ({
  household,
  profiles,
  accounts
}: {
  household: HouseholdStore
  profiles?: ProfileStore
  accounts?: UserAccountStore
}) => {
  const router = express.Router()

  // A household's photo, for its people only: an account with a profile there, or a young profile's own device.
  router.get('/households/:id/photo', (request, response) => {
    const id = Number(request.params.id)
    const accountId = response.locals.accountId as number | undefined
    const linkedId = response.locals.linkedProfileId as number | undefined
    const member =
      linkedId !== undefined
        ? profiles?.householdOf(linkedId) === id
        : accountId !== undefined && accounts?.profileOf(accountId, id) != null
    if (!member) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    sendHouseholdPhoto(household, id, request, response)
  })

  return router
}
