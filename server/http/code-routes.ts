import { cleanHandle } from '../handle.ts'
import express from 'express'
import { hashPassword } from '../auth/password.ts'
import { currentHouseholdId, inHousehold } from '../db/household-scope.ts'
import { type ProfileStore, cleanName, isYoung, profileColorOf } from '../db/profile-store.ts'
import { type SignInCodeStore, signInCodeOf } from '../db/sign-in-code-store.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import {
  type CodeHelpers,
  type CodeJoinOptions,
  type ResolvedJoinOptions,
  type ValidCode,
  codeHelpers,
  decoyHashOnce,
  existingAccountOf,
  joinRequestOf,
  withProfileCookie
} from './code-join.ts'
import { ANYONE_IN, refuseSignIn } from './sign-in-check.ts'
import { isPassword } from './household-input.ts'
import { type InvitationMail, invitationRoutes, inviteOf, mailInvitation } from './invitation-routes.ts'
import { isServerAdminOf, isParentOf, profileIdOf } from './profile-routes.ts'

// "J'ai un code": an adult of the household invites a new adult, or the admin gives an adult profile without an
// account its person; that person types the code on the Connexion page and makes their own account. The admin's code
// for an adult who has an account is "Mot de passe oublié": that person chooses a new password. A young one signs in
// with its own account, which its parents made: no code links a device to it.

interface JoinChecked {
  valid: ValidCode
  existing: boolean
  email: string
  known: UserAccount | null
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
  { valid, existing, email, known, passwordHash, name, color, handle }: JoinChecked,
  request: express.Request,
  response: express.Response
) => {
  const { codes, accounts, profiles, now, cookieFor, onProfileCreated, signsInHere } = options
  if (existing ? accounts.householdOf(known!.id) !== null : accounts.byEmail(email)) {
    response.status(409).json({ error: existing ? 'already_member' : 'email_taken' })
    return
  }
  const taken = codes.take(valid.code, now())
  if (!taken) {
    response.status(403).json({ error: 'invalid_code' })
    return
  }
  const account = known ?? accounts.create(email, passwordHash, now(), { handle })!
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

// The new profile's name and colour: the account's own once it has been in a household, else what the person typed.
const identityFor = (
  { accounts }: ResolvedJoinOptions,
  draft: { name?: unknown; color?: unknown },
  known: UserAccount | null
) => {
  const own = known ? accounts.identityOf(known.id) : null
  const name = cleanName(own?.name ?? draft.name)
  const color = profileColorOf(own?.color ?? draft.color)
  return name && color ? { name, color } : null
}

// An account that has been in a household joins with its own name and colour: it may send none. An identifier sent
// must be a valid one.
const draftIsWhole = (
  options: ResolvedJoinOptions,
  asked: { existing: boolean; draft: { name?: unknown; color?: unknown; handle?: unknown } },
  profileId: number | null,
  handle: string | null
) => {
  if (profileId === null && !asked.existing && !identityFor(options, asked.draft, null)) return false
  return asked.draft.handle === undefined || handle !== null
}

// "Rejoins <foyer>" or "Ton profil t'attend": the account, its profile, and this device signed in with both.
// existing: « J'ai déjà un compte », its e-mail and password instead of a new account (the server's admin, or with
// a plugin someone from another household).
const mountJoinRoute = (router: express.Router, options: ResolvedJoinOptions, { validCode }: CodeHelpers) => {
  const decoyHash = decoyHashOnce()
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
    if (!draftIsWhole(options, asked, valid.found.profileId, handle)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    let known: UserAccount | null = null
    let passwordHash = ''
    if (asked.existing) {
      known = await existingAccountOf(options, decoyHash, asked, request, response)
      if (!known) return
      // Never in a household yet: the person says who they are first.
      if (valid.found.profileId === null && !identityFor(options, asked.draft, known)) {
        response.status(400).json({ error: 'profile_needed' })
        return
      }
    } else {
      const refusal = newAccountRefusal(options, asked.email, handle)
      if (refusal) {
        response.status(409).json({ error: refusal })
        return
      }
      passwordHash = await hashPassword(asked.password)
    }
    const identity = identityFor(options, asked.draft, known)
    const checked = {
      ...{ valid, existing: asked.existing, email: asked.email, known, passwordHash, handle },
      ...{ name: identity?.name ?? null, color: identity?.color ?? null }
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
  const { codes, now } = options
  const router = express.Router()
  // A code belongs to one household: what it opens, makes or changes stays in that one (household-scope.ts).
  router.use((request, _response, next) => {
    const code = signInCodeOf(request.body?.code)
    const found = code ? codes.peek(code, now()) : null
    inHousehold(found?.householdId ?? currentHouseholdId(), next)
  })
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
  const target = typeof profileId === 'number' ? profiles.get(profileId) : null
  // One's own password changes in Réglages › Compte et données, with the current one.
  if (!target || target.id === profileIdOf(response)) {
    response.status(400).json({ error: 'bad_request' })
    return
  }
  // The admin first, so no one else learns from the answer which profiles are young.
  if (!isServerAdminOf(response)) {
    response.status(403).json({ error: 'admin_only' })
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
