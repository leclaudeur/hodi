import express from 'express'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword, needsRehash, verifyPassword } from '../auth/password.ts'
import { clientAddressOf } from './client-address.ts'
import { clearedProfileCookie, profileCookie, profileToken } from '../auth/session.ts'
import {
  PROFILE_AVATARS,
  profileColorOf,
  PROFILE_KINDS,
  type Profile,
  type ProfileAvatar,
  type ProfileKind,
  type ProfileStore,
  cleanName,
  isYoung
} from '../db/profile-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import { type Guard, guardOf } from './profile-guard.ts'
import { type CheckProof, askingWithProof } from './proof.ts'
import { mountPhotoRoutes } from './profile-photos.ts'

// "Qui lit ?": the household's profiles, the one open on this device, and their names, colours and photos.

const isKind = (value: unknown): value is ProfileKind => PROFILE_KINDS.includes(value as ProfileKind)
const isAvatar = (value: unknown): value is ProfileAvatar => PROFILE_AVATARS.includes(value as ProfileAvatar)

// A password typed in "Qui lit ?". Wrong ones count per account and per device: a child guessing a parent's password
// on its tablet blocks only that account there, never the parents' own devices. All devices together stop far
// later, which still caps a guess spread over several devices.
export const PIN_MAX_FAILURES = 5
export const PIN_GLOBAL_MAX_FAILURES = 50
const MAX_PASSWORD_LENGTH = 256

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

// The whole server's things (its plugins, its settings) are its admin's: the account that set Hodi up.
export const isServerAdminOf = (response: express.Response) => response.locals.serverAdmin === true

export const requireServerAdmin: express.RequestHandler = (_request, response, next) => {
  if (isServerAdminOf(response)) next()
  else response.status(403).json({ error: 'server_admin_only' })
}

interface ProfileRoutesOptions {
  profiles: ProfileStore
  now: () => number
  // Signs the device's choice of a profile.
  secret: Buffer
  pinThrottle: LoginThrottle
  // The people's accounts, whose passwords open their profiles; absent in tests without accounts.
  accounts?: UserAccountStore
  // The session cookie of an account on this device: the one whose profile opens here becomes the device's.
  signIn?: (account: UserAccount, request: express.Request) => string
  // What a new profile starts with (the base sources only).
  onCreate?: (profileId: number) => void
  // What else goes with a deleted profile (its devices' alerts).
  onDelete?: (profileId: number) => void
  // A profile changed (its kind among others).
  onChange?: (profile: Profile) => void
  // The admin's own password, before what cannot be undone for another adult who has an account.
  checkProof?: CheckProof
}

export const profileRoutes = (options: ProfileRoutesOptions) => {
  const router = express.Router()
  const helpers = profileHelpers(options)
  mountListRoutes(router, options)
  mountCurrentRoutes(router, options, helpers)
  mountEditRoutes(router, options, helpers)
  mountAdminRoutes(router, options, helpers)
  mountPhotoRoutes(router, options, helpers)
  return router
}

const profileHelpers = ({ profiles, now, secret, pinThrottle, accounts, checkProof }: ProfileRoutesOptions) => {
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

  // true when the password is right, or there is none to give; else the refusal is sent.
  const checkPassword = async (
    guard: Guard,
    password: unknown,
    request: express.Request,
    response: express.Response
  ) => {
    if (guard === 'no_account') {
      response.status(403).json({ error: 'no_account' })
      return false
    }
    const account = guard
    if (!account) return true
    const client = `${account.id}|${clientAddressOf(request)}`
    const decision = pinThrottle.check(now(), client)
    if (!decision.allowed) {
      response.set('Retry-After', String(decision.retryAfterSeconds))
      response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
      return false
    }
    if (
      typeof password === 'string' &&
      password.length <= MAX_PASSWORD_LENGTH &&
      (await verifyPassword(password, account.passwordHash))
    ) {
      if (needsRehash(account.passwordHash)) accounts?.upgradePassword(account.id, await hashPassword(password))
      return true
    }
    pinThrottle.recordFailure(now(), client)
    response.status(403).json({ error: 'wrong_password' })
    return false
  }

  // Another adult's profile with its account: what they read and kept goes, and they no longer read here. The admin's
  // password comes first.
  const withProof = async (target: Profile, request: express.Request, response: express.Response) => {
    if (isYoung(target) || !target.hasAccount || !accounts || !checkProof) return true
    return (await askingWithProof(checkProof, accounts, request, response)) !== null
  }

  return { idOf, mayManage, mayChange, cookieFor, checkPassword, withProof }
}

type ProfileHelpers = ReturnType<typeof profileHelpers>

// The device's account, when one is signed in here.
const deviceAccountOf = (response: express.Response) => response.locals.accountId as number | undefined

const mountListRoutes = (router: express.Router, { profiles, now, accounts, onCreate }: ProfileRoutesOptions) => {
  // locked: this device types a password before it opens that profile; own: the profile of the account signed in
  // here, if any.
  router.get('/', (_request, response) => {
    const device = deviceAccountOf(response)
    response.json({
      profiles: profiles.list().map(profile => {
        const guard = guardOf(profile, accounts)
        // An account with no password of its own (« Se connecter avec Google »): its person opens it through the
        // plugin, which signs the device in with it.
        const loginOnly = guard !== null && guard !== 'no_account' && !guard.hasPassword
        return { ...profile, locked: guard !== null, ...(loginOnly ? { loginOnly } : {}) }
      }),
      current: profileIdOf(response),
      own: device === undefined || !accounts ? null : accounts.profileOf(device),
      // The profile opened here is the server admin's: Réglages shows the way to /server.
      serverAdmin: isServerAdminOf(response)
    })
  })

  // The admin adds any profile; a parent adds young ones.
  router.post('/', (request, response) => {
    const name = cleanName(request.body?.name)
    const color = profileColorOf(request.body?.color)
    const kind: unknown = request.body?.kind ?? 'adult'
    const avatar: unknown = request.body?.avatar
    if (!name || !color || !isKind(kind) || !(avatar === undefined || isAvatar(avatar))) {
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
}

const mountCurrentRoutes = (
  router: express.Router,
  { profiles, accounts, signIn }: ProfileRoutesOptions,
  { cookieFor, checkPassword }: ProfileHelpers
) => {
  // This device now reads as that profile, after the password its guard asks for, if any.
  router.put('/current', async (request, response) => {
    const id: unknown = request.body?.id
    const profile = typeof id === 'number' ? profiles.get(id) : null
    if (!profile) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const guard = guardOf(profile, accounts)
    if (!(await checkPassword(guard, request.body?.password, request, response))) return
    // There is no device's account: whoever opens their profile here is the one signed in, for their account's pages.
    const cookies = [cookieFor(profile.id)]
    if (guard && guard !== 'no_account' && signIn && guard.id !== deviceAccountOf(response))
      cookies.push(signIn(guard, request))
    response.set('Set-Cookie', cookies)
    response.json({ current: profile.id })
  })

  // The app opening again on this device: it asks « Qui lit ? » first, like a TV's streaming app.
  router.delete('/current', (_request, response) => {
    response.set('Set-Cookie', clearedProfileCookie())
    response.status(204).end()
  })
}

const mountEditRoutes = (
  router: express.Router,
  { profiles, onChange }: ProfileRoutesOptions,
  { idOf, mayManage, mayChange }: ProfileHelpers
) => {
  // A young profile picks its own colour and avatar; its name and kind are its parents'. Only the admin makes a
  // profile an adult, or an adult young.
  router.patch('/:id', (request, response) => {
    const id = idOf(request)
    const name = request.body?.name === undefined ? undefined : cleanName(request.body.name)
    const color = request.body?.color === undefined ? undefined : profileColorOf(request.body.color)
    const kind: unknown = request.body?.kind
    const avatar: unknown = request.body?.avatar
    if (id === null) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (!mayChange(id, response)) return
    if (
      name === null ||
      color === null ||
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
      color,
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
}

const mountAdminRoutes = (
  router: express.Router,
  { profiles, accounts, checkProof, onDelete }: ProfileRoutesOptions,
  { idOf, withProof }: ProfileHelpers
) => {
  router.delete('/:id', requireAdmin, async (request, response) => {
    const id = idOf(request)
    if (id === null) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    // The admin's profile stays, whatever is typed.
    const target = profiles.get(id)!
    if (target.role === 'admin') {
      response.status(409).json({ error: 'admin_profile' })
      return
    }
    if (!(await withProof(target, request, response))) return
    if (!profiles.delete(id)) {
      response.status(409).json({ error: 'admin_profile' })
      return
    }
    onDelete?.(id)
    // Deleted from the device it was open on: back to "Qui lit ?".
    if (id === profileIdOf(response)) response.set('Set-Cookie', clearedProfileCookie())
    response.status(204).end()
  })

  // « Passer le rôle d'admin »: another adult with an account becomes the household's admin, and this one a member.
  router.put('/:id/admin', requireAdmin, async (request, response) => {
    const id = idOf(request)
    const target = id === null ? null : profiles.get(id)
    if (!target || target.id === profileIdOf(response)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (isYoung(target) || !target.hasAccount) {
      response.status(409).json({ error: 'no_account' })
      return
    }
    if (!accounts || !checkProof || !(await askingWithProof(checkProof, accounts, request, response))) {
      if (!response.headersSent) response.status(403).json({ error: 'account_only' })
      return
    }
    if (!profiles.handOverAdmin(target.id)) {
      response.status(409).json({ error: 'no_account' })
      return
    }
    response.status(204).end()
  })
}
