import express from 'express'
import { MAX_PHOTO_BYTES, PHOTO_TYPES, type PhotoType, type ProfileStore } from '../db/profile-store.ts'
import { pictureMaker } from '../news/picture-maker.ts'
import { CONFIG } from '../fixed-config.ts'
import { profileIdOf } from './request-locals.ts'
import { idParam } from './id-param.ts'

// The app makes a photo 256 pixels square; a header that declares far more is refused, since a few kilobytes could
// unpack into gigabytes in every browser that shows it.
const MAX_PHOTO_SIDE = CONFIG.profiles.photoSide

// The type an uploaded picture really has, read from its header by sharp; null when it is none of the three, larger
// than MAX_PHOTO_SIDE, or on a processor sharp cannot run on, since its size cannot be checked there.
export const photoFormatOf = async (data: Buffer, sharp = pictureMaker): Promise<PhotoType | null> => {
  if (!sharp) return null
  const meta = await sharp(data)
    .metadata()
    .catch(() => null)
  if (!meta?.width || !meta.height || meta.width > MAX_PHOTO_SIDE || meta.height > MAX_PHOTO_SIDE) return null
  const format = meta.format
  return format === 'webp' ? 'image/webp' : format === 'jpeg' ? 'image/jpeg' : format === 'png' ? 'image/png' : null
}

// A profile's photo: changed by whoever may change the profile.
export const mountPhotoRoutes = (
  router: express.Router,
  {
    profiles,
    now,
    knows
  }: { profiles: ProfileStore; now: () => number; knows?: (profileId: number, otherId: number) => boolean },
  {
    idOf,
    mayChange
  }: {
    idOf: (request: express.Request) => number | null
    mayChange: (id: number, response: express.Response) => boolean
  }
) => {
  // The picture itself, square and small, made on the device (image/webp, jpeg or png).
  router.put(
    '/:id/photo',
    express.raw({ type: [...PHOTO_TYPES], limit: MAX_PHOTO_BYTES }),
    async (request, response) => {
      const id = idOf(request)
      const type = request.get('content-type')?.split(';')[0]?.trim() as PhotoType | undefined
      if (id === null) {
        response.status(404).json({ error: 'not_found' })
        return
      }
      if (!mayChange(id, response)) return
      // A child wears its drawn avatar.
      if (profiles.get(id)!.kind === 'child') {
        response.status(409).json({ error: 'child' })
        return
      }
      if (!type || !PHOTO_TYPES.includes(type) || !Buffer.isBuffer(request.body) || request.body.length === 0) {
        response.status(400).json({ error: 'bad_request' })
        return
      }
      // What the bytes are, not what the request says: anything else is never served back as a picture.
      if ((await photoFormatOf(request.body)) !== type) {
        response.status(400).json({ error: 'bad_request' })
        return
      }
      response.json(profiles.setPhoto(id, { data: request.body, type }, now()))
    }
  )

  router.delete('/:id/photo', (request, response) => {
    const id = idOf(request)
    if (id === null) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!mayChange(id, response)) return
    response.json(profiles.setPhoto(id, null, now()))
  })

  // ?v=<photoVersion>: a new photo has a new address, so each one is kept by the browser for good. Read by the device's
  // accounts for their profiles, and for someone else's by those it shared with or is family of: ids follow each other,
  // so anyone else would go through every adult's photo.
  router.get('/:id/photo', (request, response) => {
    const asked = idParam(request.params.id)
    const target = Number.isInteger(asked) ? profiles.find(asked) : null
    const me = profileIdOf(response)
    const known = target !== null && me !== null && (knows?.(me, target.id) ?? false)
    const id = target && (idOf(request) !== null || known) ? target.id : null
    const photo = id === null ? null : profiles.photo(id)
    if (!photo) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    response.set('Content-Type', photo.type)
    response.set('Cache-Control', request.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache')
    response.send(photo.data)
  })
}
