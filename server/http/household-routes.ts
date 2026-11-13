import express from 'express'
import { cleanHouseholdName, isHourCycle } from '../db/household-store.ts'
import { currentHouseholdId } from '../db/household-scope.ts'
import { MAX_PHOTO_BYTES, PHOTO_TYPES, type PhotoType } from '../db/profile-store.ts'
import { isLanguage } from '../../shared/i18n.ts'
import { aiOf, countryOf, keyHint, providersList, timeZoneOf } from './household-input.ts'
import { photoFormatOf } from './profile-photos.ts'
import type { HouseholdRoutesOptions } from './setup-routes.ts'

type HouseholdOptions = Pick<HouseholdRoutesOptions, 'household' | 'providers' | 'defaultTimeZone' | 'onChange' | 'now'>

// After the session and profile checks, the admin's only: Réglages > Foyer and the AI's provider and key.
export const householdRoutes = (options: HouseholdOptions) => {
  const router = express.Router()
  const view = householdView(options)
  mountSettingsRoutes(router, options, view)
  mountPhotoRoutes(router, options, view)
  mountAiRoutes(router, options, view)
  return router
}

const householdView =
  ({ household, providers, defaultTimeZone }: HouseholdOptions) =>
  () => {
    const current = household.get()
    const provider = providers.find(candidate => candidate.id === current.ai?.provider)
    return {
      name: current.name,
      timeZone: current.timeZone ?? defaultTimeZone,
      country: current.country,
      language: current.language,
      hourCycle: current.hourCycle,
      // Its people's address for it, as a plugin's household.photo.
      photo:
        current.photoVersion === null
          ? null
          : `/api/households/${currentHouseholdId()}/photo?v=${current.photoVersion}`,
      ai:
        current.ai && provider
          ? {
              provider: provider.id,
              providerName: provider.name,
              model: current.ai.model ?? provider.defaultModel,
              keyHint: keyHint(current.ai.key)
            }
          : null,
      providers: providersList(providers)
    }
  }

type HouseholdView = ReturnType<typeof householdView>

const mountSettingsRoutes = (
  router: express.Router,
  { household, onChange }: HouseholdOptions,
  view: HouseholdView
) => {
  router.get('/', (_request, response) => {
    response.json(view())
  })

  router.patch('/', (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const name = body.name === undefined ? undefined : cleanHouseholdName(body.name)
    const timeZone = timeZoneOf(body.timeZone)
    const country = countryOf(body.country)
    const language = body.language
    const hourCycle = body.hourCycle
    if (
      name === null ||
      timeZone === false ||
      timeZone === null ||
      country === false ||
      (language !== undefined && !isLanguage(language)) ||
      (hourCycle !== undefined && !isHourCycle(hourCycle))
    ) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (name) household.rename(name)
    if (isLanguage(language)) household.setLanguage(language)
    if (isHourCycle(hourCycle)) household.setHourCycle(hourCycle)
    if (timeZone !== undefined || country !== undefined) {
      household.setRegion({ timeZone, country })
      onChange()
    }
    response.json(view())
  })
}

const mountPhotoRoutes = (router: express.Router, { household, now }: HouseholdOptions, view: HouseholdView) => {
  // The household's photo, square and small, made on the device (image/webp, jpeg or png), as a profile's.
  router.put('/photo', express.raw({ type: [...PHOTO_TYPES], limit: MAX_PHOTO_BYTES }), async (request, response) => {
    const type = request.get('content-type')?.split(';')[0]?.trim() as PhotoType | undefined
    if (!type || !PHOTO_TYPES.includes(type) || !Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    // What the bytes are, not what the request says: anything else is never served back as a picture.
    if ((await photoFormatOf(request.body)) !== type) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    household.setPhoto({ data: request.body, type }, now())
    response.json(view())
  })

  router.delete('/photo', (_request, response) => {
    household.setPhoto(null, now())
    response.json(view())
  })
}

const mountAiRoutes = (
  router: express.Router,
  { household, providers, onChange }: HouseholdOptions,
  view: HouseholdView
) => {
  router.post('/ai/check', async (request, response) => {
    const ai = aiOf(providers, request.body)
    response.json({ result: ai ? await ai.provider.checkKey(ai.key) : 'invalid' })
  })

  // A key is kept only once its provider took it.
  router.put('/ai', async (request, response) => {
    const ai = aiOf(providers, request.body)
    const result = ai ? await ai.provider.checkKey(ai.key) : 'invalid'
    if (!ai || result !== 'ok') {
      response.status(422).json({ error: 'key_refused', result })
      return
    }
    household.setAi({ provider: ai.provider.id, key: ai.key, model: null })
    onChange()
    response.json(view())
  })

  router.delete('/ai', (_request, response) => {
    household.setAi(null)
    onChange()
    response.json(view())
  })
}
