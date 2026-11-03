import express from 'express'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword, verifyPassword } from '../auth/password.ts'
import { clientAddressOf } from './client-address.ts'
import { clearedProfileCookie, profileCookie, profileToken } from '../auth/session.ts'
import {
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  PROFILE_AVATARS,
  PROFILE_COLORS,
  PROFILE_KINDS,
  type PhotoType,
  type Profile,
  type ProfileAvatar,
  type ProfileColor,
  type ProfileKind,
  type ProfileStore,
  cleanName,
  isYoung
} from '../db/profile-store.ts'

// "Qui lit ?": the household's profiles, the one open on this device, and their names, colours and photos.

const isColor = (value: unknown): value is ProfileColor => PROFILE_COLORS.includes(value as ProfileColor)
const isKind = (value: unknown): value is ProfileKind => PROFILE_KINDS.includes(value as ProfileKind)
const isAvatar = (value: unknown): value is ProfileAvatar => PROFILE_AVATARS.includes(value as ProfileAvatar)

// Four digits, typed in four boxes. Wrong ones count per code and per device: a child guessing a parent's PIN on its
// tablet blocks only that code on that tablet, never the parents' own devices. All devices together stop far later,
// which still caps a guess spread over several devices.
const PIN = /^\d{4}$/
export const PIN_MAX_FAILURES = 5
export const PIN_GLOBAL_MAX_FAILURES = 50
const isPin = (value: unknown): value is string => typeof value === 'string' && PIN.test(value)

// The profile a request is for, set by the app's middleware.
export const profileIdOf = (response: express.Response) => response.locals.profileId as number

// Whether that profile is the household's admin (always, in an app without profiles).
export const isAdminOf = (response: express.Response) => response.locals.admin === true

// The kind of the profile a request is for: an adult is a parent of the household's young profiles.
export const kindOf = (response: express.Response) => (response.locals.kind as ProfileKind | undefined) ?? 'adult'
export const isParentOf = (response: express.Response) => kindOf(response) === 'adult'

// The household's shared things (its profiles, its stored texts) are the admin's to change.
export const requireAdmin: express.RequestHandler = (_request, response, next) => {
  if (isAdminOf(response)) next()
  else response.status(403).json({ error: 'admin_only' })
}

export const profileRoutes = ({
  profiles,
  now,
  secret,
  pinThrottle,
  onCreate,
  onDelete,
  onChange
}: {
  profiles: ProfileStore
  now: () => number
  // Signs the device's choice of a profile.
  secret: Buffer
  pinThrottle: LoginThrottle
  // What a new profile starts with (the base sources only).
  onCreate?: (profileId: number) => void
  // What else goes with a deleted profile (its devices' alerts).
  onDelete?: (profileId: number) => void
  // A profile changed (its kind among others).
  onChange?: (profile: Profile) => void
}) => {
  const router = express.Router()

  const idOf = (request: express.Request) => {
    const id = Number(request.params.id)
    return Number.isInteger(id) && profiles.get(id) ? id : null
  }

  // A member changes its own name, colour and photo; the admin every profile's; a parent the young profiles'.
  const mayManage = (target: Profile, response: express.Response) =>
    isAdminOf(response) || (isParentOf(response) && isYoung(target))
  const mayChange = (id: number, response: express.Response) => {
    if (id === profileIdOf(response) || mayManage(profiles.get(id)!, response)) return true
    response.status(403).json({ error: 'admin_only' })
    return false
  }

  const cookieFor = (id: number) => profileCookie(profileToken(id, profiles.lock(id)?.version ?? 0, secret))

  // true when the PIN is right, or there is none to give; else the refusal is sent.
  // code: the profile whose PIN is asked, or the Code parental.
  const checkPin = async (
    code: number | 'parental',
    hash: string | null | undefined,
    pin: unknown,
    request: express.Request,
    response: express.Response
  ) => {
    if (!hash) return true
    const client = `${code}|${clientAddressOf(request)}`
    const decision = pinThrottle.check(now(), client)
    if (!decision.allowed) {
      response.set('Retry-After', String(decision.retryAfterSeconds))
      response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
      return false
    }
    if (isPin(pin) && (await verifyPassword(pin, hash))) return true
    pinThrottle.recordFailure(now(), client)
    response.status(403).json({ error: 'wrong_pin' })
    return false
  }

  // parentalCode: whether the household has a Code parental (Réglages > Foyer > Famille).
  router.get('/', (_request, response) => {
    response.json({
      profiles: profiles.list(),
      current: profileIdOf(response),
      parentalCode: profiles.parentalPin() !== null
    })
  })

  // The admin adds any profile; a parent adds young ones.
  router.post('/', (request, response) => {
    const name = cleanName(request.body?.name)
    const color: unknown = request.body?.color
    const kind: unknown = request.body?.kind ?? 'adult'
    const avatar: unknown = request.body?.avatar
    if (!name || !isColor(color) || !isKind(kind) || !(avatar === undefined || isAvatar(avatar))) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!isAdminOf(response) && !(isParentOf(response) && kind !== 'adult')) {
      response.status(403).json({ error: 'admin_only' })
      return
    }
    const profile = profiles.create(name, color, now(), { kind, avatar })
    if (!profile) {
      response.status(409).json({ error: 'limit' })
      return
    }
    onCreate?.(profile.id)
    response.status(201).json(profile)
  })

  // This device now reads as that profile, after its PIN when it has one, or the Code parental for an adult
  // without one.
  router.put('/current', async (request, response) => {
    const id: unknown = request.body?.id
    if (typeof id !== 'number' || !profiles.get(id)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const lock = profiles.lock(id)
    const code = lock?.hash ? id : 'parental'
    if (!(await checkPin(code, lock?.hash ?? lock?.parental, request.body?.pin, request, response))) return
    response.set('Set-Cookie', cookieFor(id))
    response.json({ current: id })
  })

  // A profile's own PIN, which makes it private: added, changed (the current one first) or removed (pin: null).
  // The other devices open on it choose it again; this one stays. The admin may also remove a member's
  // forgotten one, without it. A young profile has none: its parents open it.
  router.put('/:id/pin', async (request, response) => {
    const id = idOf(request)
    const pin: unknown = request.body?.pin
    if (id === null) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (pin !== null && isYoung(profiles.get(id)!)) {
      response.status(403).json({ error: 'young' })
      return
    }
    if (id !== profileIdOf(response)) {
      if (pin === null && isAdminOf(response)) {
        response.json(profiles.setPin(id, null))
        return
      }
      response.status(403).json({ error: 'not_yours' })
      return
    }
    if (pin !== null && !isPin(pin)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!(await checkPin(id, profiles.lock(id)?.hash, request.body?.current, request, response))) return
    const profile = profiles.setPin(id, pin === null ? null : await hashPassword(pin))
    response.set('Set-Cookie', cookieFor(id))
    response.json(profile)
  })

  // A young profile picks its own colour and avatar; its name and kind are its parents'. Only the admin makes a
  // profile an adult, or an adult young.
  // The Code parental, the admin's: set, changed (the current one first) or removed (pin: null). Every device open
  // on an adult it guards asks for it again; this one stays.
  router.put('/parental-pin', requireAdmin, async (request, response) => {
    const pin: unknown = request.body?.pin
    if (pin !== null && !isPin(pin)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!(await checkPin('parental', profiles.parentalPin(), request.body?.current, request, response))) return
    profiles.setParentalPin(pin === null ? null : await hashPassword(pin))
    response.set('Set-Cookie', cookieFor(profileIdOf(response)))
    response.json({ parentalCode: pin !== null })
  })

  router.patch('/:id', (request, response) => {
    const id = idOf(request)
    const name = request.body?.name === undefined ? undefined : cleanName(request.body.name)
    const color: unknown = request.body?.color
    const kind: unknown = request.body?.kind
    const avatar: unknown = request.body?.avatar
    if (id === null) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!mayChange(id, response)) return
    if (
      name === null ||
      (color !== undefined && !isColor(color)) ||
      (kind !== undefined && !isKind(kind)) ||
      (avatar !== undefined && !isAvatar(avatar))
    ) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const target = profiles.get(id)!
    const selfOnly = id === profileIdOf(response) && !mayManage(target, response)
    const kindChange = kind !== undefined && kind !== target.kind
    if (
      (selfOnly && isYoung(target) && (name !== undefined || kindChange)) ||
      (kindChange && !isAdminOf(response) && (!isParentOf(response) || !isYoung(target) || kind === 'adult'))
    ) {
      response.status(403).json({ error: 'parents_only' })
      return
    }
    const updated = profiles.update(id, {
      name,
      color: color as ProfileColor | undefined,
      kind: kind as ProfileKind | undefined,
      avatar: avatar as ProfileAvatar | undefined
    })
    if (updated) onChange?.(updated)
    response.json(updated)
  })

  // The profile opened its tour, here or elsewhere: only its own reader takes it.
  router.post('/:id/tour', (request, response) => {
    const id = idOf(request)
    if (id === null) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (id !== profileIdOf(response)) {
      response.status(403).json({ error: 'not_yours' })
      return
    }
    response.json(profiles.tourTaken(id))
  })

  router.delete('/:id', requireAdmin, (request, response) => {
    const id = idOf(request)
    if (id === null) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!profiles.delete(id)) {
      response.status(409).json({ error: 'admin_profile' })
      return
    }
    onDelete?.(id)
    // Deleted from the device it was open on: back to "Qui lit ?".
    if (id === profileIdOf(response)) response.set('Set-Cookie', clearedProfileCookie())
    response.status(204).end()
  })

  // The picture itself, square and small, made on the device (image/webp, jpeg or png).
  router.put('/:id/photo', express.raw({ type: [...PHOTO_TYPES], limit: MAX_PHOTO_BYTES }), (request, response) => {
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
    response.json(profiles.setPhoto(id, { data: request.body, type }, now()))
  })

  router.delete('/:id/photo', (request, response) => {
    const id = idOf(request)
    if (id === null) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!mayChange(id, response)) return
    response.json(profiles.setPhoto(id, null, now()))
  })

  // ?v=<photoVersion>: a new photo has a new address, so each one is kept by the browser for good.
  router.get('/:id/photo', (request, response) => {
    const id = idOf(request)
    const photo = id === null ? null : profiles.photo(id)
    if (!photo) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    response.set('Content-Type', photo.type)
    response.set('Cache-Control', request.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache')
    response.send(photo.data)
  })

  return router
}
