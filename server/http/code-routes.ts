import express from 'express'
import { hashPassword } from '../auth/password.ts'
import { currentHouseholdId, inHousehold } from '../db/household-scope.ts'
import { MAX_PROFILES, type ProfileStore, cleanName, isYoung, profileColorOf } from '../db/profile-store.ts'
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
  resettableByCode,
  withProfileCookie
} from './code-join.ts'
import { type CheckProof, askingWithProof } from './proof.ts'
import { ANYONE_IN, refuseSignIn } from './sign-in-check.ts'
import { isPassword } from './household-input.ts'
import { isAdminOf, isParentOf, profileIdOf } from './profile-routes.ts'

// "J'ai un code": an adult of the household invites a new adult, or the admin gives an adult profile without an
// account its person; that person types the code on the Connexion page and makes their own account. A parent's
// code for a young profile links the device it is typed on to that profile, with no account. The admin's code for an
// adult who has an account is "Mot de passe oublié": that person chooses a new password.

interface JoinChecked {
  valid: ValidCode
  existing: boolean
  email: string
  known: UserAccount | null
  passwordHash: string
  name: ReturnType<typeof cleanName>
  color: ReturnType<typeof profileColorOf>
}

// The account, its profile, and this device signed in with both, once every check passed.
// From here on nothing waits: no other request runs between the checks and the writes.
const completeJoin = (
  options: ResolvedJoinOptions,
  { valid, existing, email, known, passwordHash, name, color }: JoinChecked,
  request: express.Request,
  response: express.Response
) => {
  const { codes, accounts, profiles, now, cookieFor, onProfileCreated, signsInHere } = options
  if (existing ? accounts.profileOf(known!.id) !== null : accounts.byEmail(email)) {
    response.status(409).json({ error: existing ? 'already_member' : 'email_taken' })
    return
  }
  if (valid.found.profileId === null && profiles.list().length >= MAX_PROFILES) {
    response.status(409).json({ error: 'household_full' })
    return
  }
  const taken = codes.take(valid.code, now())
  if (!taken) {
    response.status(403).json({ error: 'invalid_code' })
    return
  }
  const account = known ?? accounts.create(email, passwordHash, now())!
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
    // A young profile's code links a device (/link), a reset code changes a password (/reset): no new account.
    if (valid.target && (isYoung(valid.target) || valid.found.reset)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const name = cleanName(asked.draft.name)
    const color = profileColorOf(asked.draft.color)
    if (valid.found.profileId === null && (!name || !color)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    let known: UserAccount | null = null
    let passwordHash = ''
    if (asked.existing) {
      known = await existingAccountOf(options, decoyHash, asked, request, response)
      if (!known) return
    } else {
      if (options.accounts.byEmail(asked.email)) {
        response.status(409).json({ error: 'email_taken' })
        return
      }
      passwordHash = await hashPassword(asked.password)
    }
    const checked = { valid, existing: asked.existing, email: asked.email, known, passwordHash, name, color }
    completeJoin(options, checked, request, response)
  })
}

// "C'est l'appareil de Léa": this device opens her profile only, from now on. Whoever was signed in on it is not
// any more.
const mountLinkRoute = (router: express.Router, options: ResolvedJoinOptions, { validCode }: CodeHelpers) => {
  const { codes, now, linkDevice } = options
  router.post('/link', (request, response) => {
    const valid = validCode(request, response)
    if (!valid) return
    if (!valid.target || !isYoung(valid.target) || !linkDevice) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    if (!codes.take(valid.code, now())) {
      response.status(403).json({ error: 'invalid_code' })
      return
    }
    const profileId = valid.target.id
    response.set('Set-Cookie', withProfileCookie(options, linkDevice(profileId, request), profileId))
    response.json({ profileId })
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
  mountLinkRoute(router, options, helpers)
  mountResetRoute(router, options, helpers)
  return router
}

interface CodeRoutesOptions {
  codes: SignInCodeStore
  profiles: ProfileStore
  // To refuse a reset code for the server's admin, or for an account of other households too.
  accounts?: UserAccountStore
  now: () => number
  // « Nouveau mot de passe » for another adult opens their account: the admin's own password comes first.
  checkProof?: CheckProof
}

// « Nouveau mot de passe » for another adult: whether this admin may give it, or the refusal sent.
const mayReset = async (
  { accounts, checkProof }: Pick<CodeRoutesOptions, 'accounts' | 'checkProof'>,
  profileId: number,
  request: express.Request,
  response: express.Response
) => {
  const account = accounts ? accounts.ofProfile(profileId) : null
  if (account && !resettableByCode(accounts!, account)) {
    response.status(403).json({ error: account.serverAdmin ? 'server_admin' : 'other_households' })
    return false
  }
  if (!accounts || !checkProof) {
    response.status(403).json({ error: 'account_only' })
    return false
  }
  return askingWithProof(checkProof, accounts, request, response)
}

// "Connecter un appareil" or "Mot de passe oublié" for one profile: the code, or the refusal sent.
const profileCode = async (
  { codes, profiles, accounts, now, checkProof }: CodeRoutesOptions,
  profileId: unknown,
  request: express.Request,
  response: express.Response
) => {
  const target = typeof profileId === 'number' ? profiles.get(profileId) : null
  // One's own password changes in Réglages › Compte et données, with the current one.
  if (!target || target.id === profileIdOf(response)) {
    response.status(400).json({ error: 'bad_request' })
    return
  }
  if (!isYoung(target) && !isAdminOf(response)) {
    response.status(403).json({ error: 'admin_only' })
    return
  }
  const reset = !isYoung(target) && target.hasAccount
  if (reset && !(await mayReset({ accounts, checkProof }, target.id, request, response))) return
  response.status(201).json(codes.create({ profileId: target.id, createdBy: profileIdOf(response), reset }, now()))
}

// After the session and profile checks: making a code.
export const codeRoutes = (options: CodeRoutesOptions) => {
  const { codes, profiles, now } = options
  const router = express.Router()

  // Without profileId, "Inviter un adulte": any adult's. With one, "Connecter un appareil": for an adult profile
  // without an account, the admin's; for a young profile, any of its parents'. For another adult who has an account,
  // "Mot de passe oublié", the admin's.
  router.post('/', async (request, response) => {
    if (response.locals.profileChosen !== true || !isParentOf(response)) {
      response.status(403).json({ error: 'adults_only' })
      return
    }
    const profileId: unknown = request.body?.profileId
    if (profileId !== undefined && profileId !== null) {
      await profileCode(options, profileId, request, response)
      return
    }
    if (profiles.list().length >= MAX_PROFILES) {
      response.status(409).json({ error: 'household_full' })
      return
    }
    response.status(201).json(codes.create({ createdBy: profileIdOf(response) }, now()))
  })

  return router
}
