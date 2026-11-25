import express from 'express'
import { clearedProfileCookie } from '../auth/session.ts'
import {
  PROFILE_AVATARS,
  profileColorOf,
  PROFILE_KINDS,
  type Profile,
  type ProfileAvatar,
  type ProfileKind,
  cleanName,
  isYoung
} from '../db/profile-store.ts'
import {
  type CurrentRoutesOptions,
  deviceAccountOf,
  guardFor,
  isHere,
  mountCurrentRoutes
} from './profile-current-routes.ts'
import { isParentOfYoung } from './parent-check.ts'
import { isAccountGuard, lockOf } from './profile-guard.ts'
import { mountPhotoRoutes } from './profile-photos.ts'

// "Qui lit ?": the household's profiles, the one open on this device, and their names, colours and photos.

const isKind = (value: unknown): value is ProfileKind => PROFILE_KINDS.includes(value as ProfileKind)
const isAvatar = (value: unknown): value is ProfileAvatar => PROFILE_AVATARS.includes(value as ProfileAvatar)

// A password or code typed in "Qui lit ?": see profile-current-routes.ts.
export const PIN_MAX_FAILURES = CONFIG.profilePin.failures
export const PIN_GLOBAL_MAX_FAILURES = CONFIG.profilePin.failuresServerWide

import { isParentOf, isServerAdminOf, kindOf, profileIdOf } from './request-locals.ts'
import { CONFIG } from '../fixed-config.ts'
import { idParam } from './id-param.ts'

export { isParentOf, isServerAdminOf, kindOf, profileIdOf }

// The whole server's things (its plugins, its settings, its stored texts, other people's profiles) are its admin's.
export const requireServerAdmin: express.RequestHandler = (_request, response, next) => {
  if (isServerAdminOf(response)) next()
  else response.status(403).json({ error: 'server_admin_only' })
}

interface ProfileRoutesOptions extends CurrentRoutesOptions {
  // What a new profile starts with (the base sources only).
  onCreate?: (profileId: number) => void
  // What else goes with a deleted profile (its devices' alerts).
  onDelete?: (profileId: number) => void
  // A profile changed (its kind among others).
  onChange?: (profile: Profile) => void
  // Whether a profile has a tie with another account's (a share, family), which shows that one's photo.
  knows?: (profileId: number, otherId: number) => boolean
}

export const profileRoutes = (options: ProfileRoutesOptions) => {
  const router = express.Router()
  const helpers = profileHelpers(options)
  mountListRoutes(router, options)
  mountCurrentRoutes(router, options)
  mountEditRoutes(router, options, helpers)
  mountAdminRoutes(router, options, helpers)
  mountPhotoRoutes(router, options, helpers)
  return router
}

const profileHelpers = ({ profiles, accounts }: ProfileRoutesOptions) => {
  const idOf = (request: express.Request) => {
    const id = idParam(request.params.id)
    return Number.isInteger(id) && profiles.get(id) ? id : null
  }

  // A member changes its own name, colour and photo; the admin every profile's; a parent the young profiles'.
  const mayManage = (target: Profile, response: express.Response) =>
    isYoung(target) ? isParentOfYoung(response, accounts, target) : isServerAdminOf(response)
  const mayChange = (id: number, response: express.Response) => {
    if (id === profileIdOf(response) || mayManage(profiles.get(id)!, response)) return true
    response.status(403).json({ error: 'admin_only' })
    return false
  }

  // An adult's, the admin's to delete; a teen's or a child's, its parents'.
  const mayDelete = (target: Profile, response: express.Response) => {
    if (isYoung(target) ? isParentOfYoung(response, accounts, target) : isServerAdminOf(response)) return true
    response.status(403).json({ error: isYoung(target) ? 'parents_only' : 'admin_only' })
    return false
  }

  return { idOf, mayManage, mayChange, mayDelete }
}

type ProfileHelpers = ReturnType<typeof profileHelpers>

const mountListRoutes = (router: express.Router, options: ProfileRoutesOptions) => {
  const { profiles, now, accounts, trust, onCreate } = options
  const guardOfProfile = guardFor(options)
  // locked: this device types something before it opens that profile, lock says what; own: the profile of the
  // account signed in here, if any.
  router.get('/', (request, response) => {
    const device = deviceAccountOf(response)
    response.json({
      profiles: profiles.list().map(profile => {
        const guard = guardOfProfile(profile, request)
        const lock = lockOf(guard, isAccountGuard(guard) && trust?.trustedFor(request, guard) != null)
        // An account with no password of its own (« Se connecter avec Google »): its person opens it through the
        // plugin, which signs the device in with it.
        const loginOnly = lock === 'password' && isAccountGuard(guard) && !guard.hasPassword
        // here: « Qui lit ? » shows it on this device (its account is signed in here, or it is young).
        return {
          ...profile,
          locked: lock !== null,
          here: isHere(options, profile, request),
          ...(lock ? { lock } : {}),
          ...(loginOnly ? { loginOnly } : {})
        }
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
    if (!isServerAdminOf(response) && !(isParentOf(response) && kind !== 'adult')) {
      response.status(403).json({ error: 'admin_only' })
      return
    }
    const profile = profiles.create(name, color, now(), { kind, avatar })
    if (!profile) {
      response.status(409).json({ error: 'limit' })
      return
    }
    // Every teen and child has an account, run by the parent who made it; it gets a password from its card.
    const parent = accounts?.ofProfile(profileIdOf(response))
    if (kind !== 'adult' && accounts) accounts.young.adopt(profile.id, parent ? [parent.id] : [], now())
    onCreate?.(profile.id)
    response.status(201).json(profile)
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
      (kindChange && !isServerAdminOf(response) && (!isParentOf(response) || !isYoung(target) || kind === 'adult'))
    ) {
      response.status(403).json({ error: 'parents_only' })
      return
    }
    // An adult's account and a young one's are not the same kind of account: the way from one to the other is still to
    // come.
    if (kindChange && target.hasAccount && isYoung(target) !== (kind !== 'adult')) {
      response.status(409).json({ error: 'kind_fixed' })
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
  { profiles, accounts, onDelete }: ProfileRoutesOptions,
  { idOf, mayDelete }: ProfileHelpers
) => {
  // A teen's or a child's, its parents'; an adult's that no account reads with, the server admin's. An adult's own
  // profile goes only with its account (Mon compte, or Serveur › Comptes).
  router.delete('/:id', async (request, response) => {
    const id = idOf(request)
    if (id === null) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    // The admin's profile stays, whatever is typed.
    const target = profiles.get(id)!
    if (!mayDelete(target, response)) return
    if (target.role === 'admin') {
      response.status(409).json({ error: 'admin_profile' })
      return
    }
    if (!isYoung(target) && target.hasAccount) {
      response.status(409).json({ error: 'account_profile' })
      return
    }
    // A teen's or a child's account goes with its profile; with two parents, once one has stepped back.
    const young = isYoung(target) ? accounts?.ofProfile(id) : null
    if (young && accounts!.young.invitations.parentsOf(young.id).length > 1) {
      response.status(409).json({ error: 'two_parents' })
      return
    }
    if (young) accounts!.young.delete(profiles, { accountId: young.id, profileId: id })
    else if (!profiles.delete(id)) {
      response.status(409).json({ error: 'admin_profile' })
      return
    }
    onDelete?.(id)
    // Deleted from the device it was open on: back to "Qui lit ?".
    if (id === profileIdOf(response)) response.set('Set-Cookie', clearedProfileCookie())
    response.status(204).end()
  })
}
