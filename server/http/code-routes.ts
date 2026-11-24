import { cleanHandle } from '../handle.ts'
import express from 'express'
import { hashPassword } from '../auth/password.ts'
import { type ProfileStore, cleanName, isYoung, profileColorOf } from '../db/profile-store.ts'
import type { SignInCodeStore } from '../db/sign-in-code-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import {
  type CodeHelpers,
  type CodeJoinOptions,
  type ResolvedJoinOptions,
  type ValidCode,
  codeHelpers,
  joinRequestOf,
  withProfileCookie
} from './code-join.ts'
import { ANYONE_IN, refuseSignIn } from './sign-in-check.ts'
import { isPassword } from './household-input.ts'
import { type InvitationMail, invitationRoutes, inviteOf, mailInvitation } from './invitation-routes.ts'
import { isServerAdminOf, isParentOf, profileIdOf } from './profile-routes.ts'

// "J'ai un code": an adult invites a new adult, or the admin gives an adult profile without an
// account its person; that person types the code on the Connexion page and makes their own account. The admin's code
// for an adult who has an account is "Mot de passe oublié": that person chooses a new password. A young one signs in
// with its own account, which its parents made: no code links a device to it.

interface JoinChecked {
  valid: ValidCode
  email: string
  passwordHash: string
  name: ReturnType<typeof cleanName>
  color: ReturnType<typeof profileColorOf>
  // The new account's identifier, as typed; null: one made from its e-mail.
  handle: string | null
}

// The account, its profile, and this device signed in with both, once every check passed.
// From here on nothing waits: no other request runs between the checks and the writes.
const completeJoin = (
  options: ResolvedJoinOptions,
  { valid, email, passwordHash, name, color, handle }: JoinChecked,
  request: express.Request,
  response: express.Response
) => {
  const { codes, accounts, profiles, now, cookieFor, onProfileCreated, signsInHere } = options
  if (accounts.byEmail(email)) {
    response.status(409).json({ error: 'email_taken' })
    return
  }
  const taken = codes.take(valid.code, now())
  if (!taken) {
    response.status(403).json({ error: 'invalid_code' })
    return
  }
  const account = accounts.create(email, passwordHash, now(), { handle })!
  let profileId = taken.profileId
  if (profileId === null) {
    const profile = profiles.create(name!, color!, now())!
    profileId = profile.id
    onProfileCreated?.(profileId)
  }
  accounts.linkProfile(account.id, profileId)
  if (!signsInHere(account)) {
    response.json({ profileId, signIn: false })
    return
  }
  response.set('Set-Cookie', withProfileCookie(options, cookieFor(account, request), profileId))
  response.json({ profileId })
}

// A new account's e-mail and identifier, both still free.
const newAccountRefusal = ({ accounts, now }: ResolvedJoinOptions, email: string, handle: string | null) => {
  if (accounts.isBlocked(email)) return 'blocked'
  if (accounts.byEmail(email)) return 'email_taken'
  return handle && !accounts.isHandleFree(handle, now()) ? 'handle_taken' : null
}

// The new profile's name and colour, as the person typed them; an identifier sent must be a valid one.
const draftIsWhole = (
  draft: { name?: unknown; color?: unknown; handle?: unknown },
  profileId: number | null,
  handle: string | null
) => {
  if (profileId === null && (!cleanName(draft.name) || !profileColorOf(draft.color))) return false
  return draft.handle === undefined || handle !== null
}

// "Bienvenue sur Hodi" or "Ton profil t'attend": a new account, its profile, and this device signed in with both. Whoever
// already has an account signs in on Connexion: every account has its own profile.
const mountJoinRoute = (router: express.Router, options: ResolvedJoinOptions, { validCode }: CodeHelpers) => {
  router.post('/join', async (request, response) => {
    const asked = joinRequestOf((request.body ?? {}) as Record<string, unknown>)
    if (!asked) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const valid = validCode(request, response)
    if (!valid) return
    // A reset code changes a password (/reset): no new account.
    if (valid.target && valid.found.reset) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const handle = cleanHandle(asked.draft.handle)
    if (!draftIsWhole(asked.draft, valid.found.profileId, handle)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    const refusal = newAccountRefusal(options, asked.email, handle)
    if (refusal) {
      response.status(409).json({ error: refusal })
      return
    }
    const passwordHash = await hashPassword(asked.password)
    const checked = {
      ...{ valid, email: asked.email, passwordHash, handle },
      ...{ name: cleanName(asked.draft.name), color: profileColorOf(asked.draft.color) }
    }
    completeJoin(options, checked, request, response)
  })
}

// "Nouveau mot de passe": the account of the code's profile signs in with it from now on, on this device only.
const mountResetRoute = (router: express.Router, options: ResolvedJoinOptions, { validCode }: CodeHelpers) => {
  const { codes, accounts, now, resetPassword, checkSignIn } = options
  router.post('/reset', async (request, response) => {
    const password: unknown = request.body?.password
    if (!isPassword(password)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const valid = validCode(request, response)
    if (!valid) return
    const account = valid.target && valid.found.reset ? accounts.ofProfile(valid.target.id) : null
    if (!account || !resetPassword) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    // Refused before the code is used up or the password changes.
    const refusal = await checkSignIn(account)
    if (refusal) {
      refuseSignIn(response, refusal)
      return
    }
    const passwordHash = await hashPassword(password)
    // From here on nothing waits: no other request runs between the take and the writes.
    if (!codes.take(valid.code, now())) {
      response.status(403).json({ error: 'invalid_code' })
      return
    }
    const profileId = valid.target!.id
    const cookie = resetPassword(account, passwordHash, request)
    if (cookie === null) {
      response.json({ profileId, signIn: false })
      return
    }
    response.set('Set-Cookie', withProfileCookie(options, cookie, profileId))
    response.json({ profileId })
  })
}

// Before the session check: a device signed in with nothing.
export const codeJoinRoutes = ({ checkSignIn = ANYONE_IN, signsInHere = () => true, ...rest }: CodeJoinOptions) => {
  const options: ResolvedJoinOptions = { ...rest, checkSignIn, signsInHere }
  const router = express.Router()
  const helpers = codeHelpers(options)

  // "Entre le code": what it opens, so the next screen says whose household and, for a profile, whose.
  router.post('/check', (request, response) => {
    const valid = helpers.validCode(request, response)
    if (valid) response.json(helpers.describe(valid.found))
  })
  mountJoinRoute(router, options, helpers)
  mountResetRoute(router, options, helpers)
  return router
}

interface CodeRoutesOptions {
  codes: SignInCodeStore
  profiles: ProfileStore
  accounts?: UserAccountStore
  now: () => number
  // Personnes invitées: an invitation's code by e-mail, once Serveur › E-mail is set.
  mail?: InvitationMail
}

// "Connecter un appareil" for one profile: the code, or the refusal sent.
const profileCode = ({ codes, profiles, now }: CodeRoutesOptions, profileId: unknown, response: express.Response) => {
  // The admin first, so no one else learns from the answer which profiles there are, or which are young.
  if (!isServerAdminOf(response)) {
    response.status(403).json({ error: 'admin_only' })
    return
  }
  const target = typeof profileId === 'number' ? profiles.get(profileId) : null
  // One's own password changes in Réglages › Compte et données, with the current one.
  if (!target || target.id === profileIdOf(response)) {
    response.status(400).json({ error: 'bad_request' })
    return
  }
  // A young one signs in with the account its parents made: no code for it.
  if (isYoung(target)) {
    response.status(400).json({ error: 'young_account' })
    return
  }
  // An adult's password is theirs: no one in the household gives them a new one. A forgotten one goes through
  // « Mot de passe oublié », whose code only the server's admin makes (Serveur › Comptes).
  if (target.hasAccount) {
    response.status(403).json({ error: 'own_password' })
    return
  }
  response.status(201).json(codes.create({ profileId: target.id, createdBy: profileIdOf(response) }, now()))
}

// After the session and profile checks: making a code.
export const codeRoutes = (options: CodeRoutesOptions) => {
  const { codes, now } = options
  const router = express.Router()

  // Without profileId, "Inviter un adulte": any adult's. With one, "Connecter un appareil": for an adult profile
  // without an account, the admin's.
  router.post('/', async (request, response) => {
    if (response.locals.profileChosen !== true || !isParentOf(response)) {
      response.status(403).json({ error: 'adults_only' })
      return
    }
    const profileId: unknown = request.body?.profileId
    if (profileId !== undefined && profileId !== null) {
      profileCode(options, profileId, response)
      return
    }
    const invite = inviteOf(request.body)
    if (invite === 'invalid') {
      response.status(400).json({ error: 'invalid_request' })
      return
    }
    const inviter = profileIdOf(response)
    const made = codes.create({ createdBy: inviter, invite }, now())
    const sent = invite?.email
      ? mailInvitation(options.mail, { to: invite.email, code: made.code, inviter, now: now() })
      : false
    response.status(201).json({ ...made, sent })
  })
  router.use('/invitations', invitationRoutes({ codes, now, mail: options.mail }))

  return router
}
