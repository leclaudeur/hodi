import type express from 'express'
import { cleanAppUrl } from '../db/mail-settings-store.ts'
import { type ServerSettingsStore, cleanPublicHome } from '../db/server-settings-store.ts'

// A field of the request: undefined when absent, null to remove it, else the cleaned address; false when it is not one.
const addressIn = (value: unknown, clean: (value: unknown) => string | null) => {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  return clean(value) ?? false
}

// Serveur › Général: Hodi's own address, for the links it sends, and the public site a first visit goes to.
export const mountGeneralRoutes = (router: express.Router, settings: ServerSettingsStore) => {
  router.get('/general', (_request, response) => {
    response.json(settings.addresses())
  })
  router.put('/general', (request, response) => {
    const body = (request.body ?? {}) as { appUrl?: unknown; publicHome?: unknown }
    const appUrl = addressIn(body.appUrl, cleanAppUrl)
    const publicHome = addressIn(body.publicHome, cleanPublicHome)
    if (appUrl === false || publicHome === false || (appUrl === undefined && publicHome === undefined)) {
      response.status(400).json({ error: 'invalid_url' })
      return
    }
    response.json(
      settings.setAddresses({
        ...(appUrl === undefined ? {} : { appUrl }),
        ...(publicHome === undefined ? {} : { publicHome })
      })
    )
  })
}
