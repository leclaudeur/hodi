import { timingSafeEqual } from 'node:crypto'
import express from 'express'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import { profileCookie, profileToken } from '../auth/session.ts'
import { type HouseholdAi, type HouseholdStore, cleanHouseholdName } from '../db/household-store.ts'
import { type ProfileStore, cleanName, profileColorOf } from '../db/profile-store.ts'
import { signInCodeOf } from '../db/sign-in-code-store.ts'
import { type UserAccountStore, cleanEmail } from '../db/user-account-store.ts'
import { type Language, isLanguage } from '../../shared/i18n.ts'
import type { AiProvider } from '../news/ai-providers.ts'
import type { ManifestTranslations } from '../plugins/manifest-texts.ts'
import type { AccountOf, CookieFor } from './account-session.ts'
import { clientAddressOf } from './client-address.ts'
import { aiOf, countryOf, isNearby, isPassword, providersList, timeZoneOf } from './household-input.ts'

// The first-run screens, in two parts: the server admin's own account, then the household. The same start with or
// without plugins, which may add their steps between the two. Then Réglages > Foyer and > IA et crédits, the admin's.

export interface HouseholdRoutesOptions {
  household: HouseholdStore
  profiles: ProfileStore
  providers: AiProvider[]
  now: () => number
  secret: Buffer
  // The server's own time zone, when the household has none.
  defaultTimeZone: string
  // Eight letters and digits written in the server's log on a start before setup; asked of devices that are not
  // nearby.
  setupCode: string
  throttle: LoginThrottle
  // The people's own accounts; absent on an install from before them, in tests.
  accounts?: UserAccountStore
  accountOf: AccountOf
  // A session cookie for this account, signed as it is now.
  cookieFor: CookieFor
  // Region or AI changed: the news service takes the new ones.
  onChange: () => void
  // The household now exists, in this language: its base sources come in.
  onSetUp?: (language: Language) => void
  // « Mot de passe oublié » can send its link: Serveur › E-mail is set.
  canResetByMail?: () => boolean
  // « Plus tard » at the household step: whether the server's admin left the household for later, and its change.
  householdLater?: { get: () => boolean; set: (later: boolean) => void }
  // « Plugins trouvés »: the plugins put in data/plugins before the first start, and their switch.
  setupPlugins?: SetupPlugins
}

export interface SetupPlugin {
  id: string
  name: string
  description: string | null
  // Its name and description in other languages.
  translations: ManifestTranslations
  enabled: boolean
  // Whether a trusted key signed it: the step offers an unsigned plugin off.
  signed: boolean
  // Why it could not be loaded: it is listed, off, and cannot be turned on.
  error: string | null
}

export interface SetupPlugins {
  list: () => SetupPlugin[]
  setEnabled: (id: string, enabled: boolean) => void
}

// The defaults filled in.
type SetupOptions = HouseholdRoutesOptions & Required<Pick<HouseholdRoutesOptions, 'onSetUp' | 'canResetByMail'>>

// Before the session check: what the login and first-run screens need, and the setup itself.
export const setupRoutes = ({
  onSetUp = () => {},
  canResetByMail = () => false,
  ...options
}: HouseholdRoutesOptions) => {
  const router = express.Router()
  const resolved = { ...options, onSetUp, canResetByMail }
  const checks = setupChecks(resolved)
  mountSetupStateRoutes(router, resolved, checks)
  mountSetupAccountRoutes(router, resolved, checks)
  mountSetupHouseholdRoute(router, resolved, checks)
  return router
}

const setupChecks = ({ household, now, setupCode, throttle, accountOf }: SetupOptions) => {
  // The server admin signed in on this device: past "Ton compte", the session stands for the setup code.
  const adminOf = (request: express.Request) => {
    const account = accountOf(request)
    return account?.serverAdmin ? account : null
  }

  // The code, when this device needs one. False sends the answer.
  const codeOk = (request: express.Request, response: express.Response) => {
    if (isNearby(request) || adminOf(request)) return true
    const client = clientAddressOf(request)
    const decision = throttle.check(now(), client)
    if (!decision.allowed) {
      response.set('Retry-After', String(decision.retryAfterSeconds))
      response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
      return false
    }
    // Typed in any case, with or without spaces; compared in constant time.
    const typed = Buffer.from(signInCodeOf(request.body?.code) ?? '')
    const expected = Buffer.from(setupCode)
    if (typed.length !== expected.length || !timingSafeEqual(typed, expected)) {
      throttle.recordFailure(now(), client)
      response.status(403).json({ error: 'invalid_code' })
      return false
    }
    return true
  }

  const notNeeded = (response: express.Response) => {
    if (!household.isSetUp()) return false
    response.status(409).json({ error: 'already_set_up' })
    return true
  }

  return { adminOf, codeOk, notNeeded }
}

type SetupChecks = ReturnType<typeof setupChecks>

const mountSetupStateRoutes = (
  router: express.Router,
  { household, providers, accounts, canResetByMail, householdLater, setupPlugins }: SetupOptions,
  { adminOf, codeOk, notNeeded }: SetupChecks
) => {
  // stage account: nobody has an account yet, the setup starts with "Ton compte". stage household: the server admin
  // has one; signedIn says whether it is on this device, else it signs in first.
  router.get('/', (request, response) => {
    if (household.isSetUp()) {
      const { name, language } = household.get()
      response.json({ needed: false, name, language, resetByMail: canResetByMail() })
      return
    }
    // No household for now: Connexion, then /server for its admin, as on a set-up server.
    if (accounts?.any() && householdLater?.get()) {
      response.json({ needed: false, name: null, language: household.get().language, resetByMail: canResetByMail() })
      return
    }
    const providersOffered = providersList(providers)
    if (accounts?.any()) {
      const admin = adminOf(request)
      // email: for "Tout est prêt", which recalls whose account runs the server.
      response.json({
        needed: true,
        stage: 'household',
        signedIn: admin !== null,
        ...(admin ? { email: admin.email } : {}),
        // « Plugins trouvés », only when there are some.
        ...(admin && setupPlugins && setupPlugins.list().length > 0 ? { plugins: setupPlugins.list() } : {}),
        providers: providersOffered
      })
      return
    }
    response.json({ needed: true, stage: 'account', codeRequired: !isNearby(request), providers: providersOffered })
  })

  // The code alone, so the first screen can say at once whether it was right.
  router.post('/code', (request, response) => {
    if (notNeeded(response) || !codeOk(request, response)) return
    response.status(204).end()
  })

  // "Vérifier la clé": a request that costs no credits, on the click only.
  router.post('/ai-check', async (request, response) => {
    if (notNeeded(response) || !codeOk(request, response)) return
    const ai = aiOf(providers, request.body)
    if (!ai) {
      response.json({ result: 'invalid' })
      return
    }
    response.json({ result: await ai.provider.checkKey(ai.key) })
  })
}

const mountSetupAccountRoutes = (
  router: express.Router,
  { now, accounts, cookieFor, householdLater, setupPlugins }: SetupOptions,
  { adminOf, codeOk, notNeeded }: SetupChecks
) => {
  // "Ton compte": the server admin's account, which signs this device in. Only the first account is made here.
  router.post('/account', async (request, response) => {
    if (notNeeded(response) || !codeOk(request, response)) return
    const body = (request.body ?? {}) as Record<string, unknown>
    const email = cleanEmail(body.email)
    if (!accounts || !email || !isPassword(body.password)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const account = accounts.createServerAdmin(email, await hashPassword(body.password), now())
    if (!account) {
      response.status(409).json({ error: 'account_exists' })
      return
    }
    response.set('Set-Cookie', cookieFor(account, request))
    response.status(204).end()
  })

  // « Plus tard »: the server goes on with no household; its admin reaches /server, which can make one later.
  router.post('/later', (request, response) => {
    if (notNeeded(response)) return
    if (!adminOf(request)) {
      response.status(401).json({ error: 'unauthenticated' })
      return
    }
    if (!householdLater) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    householdLater.set(true)
    response.status(204).end()
  })

  // « Plugins trouvés »: the ones checked stay on, the others are turned off and stay in data/plugins.
  router.post('/plugins', (request, response) => {
    if (notNeeded(response)) return
    if (!adminOf(request)) {
      response.status(401).json({ error: 'unauthenticated' })
      return
    }
    const enabled = (request.body as { enabled?: unknown } | undefined)?.enabled
    if (!setupPlugins || !Array.isArray(enabled) || !enabled.every(id => typeof id === 'string')) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    for (const plugin of setupPlugins.list()) {
      setupPlugins.setEnabled(plugin.id, plugin.error === null && enabled.includes(plugin.id))
    }
    response.json({ plugins: setupPlugins.list() })
  })
}

const mountSetupHouseholdRoute = (
  router: express.Router,
  { household, profiles, providers, now, secret, accounts, onChange, onSetUp, householdLater }: SetupOptions,
  { adminOf, notNeeded }: SetupChecks
) => {
  // "Crée ton foyer" to "Tout est prêt": the household, with the server admin's profile as its admin.
  router.post('/', async (request, response) => {
    if (notNeeded(response)) return
    const admin = adminOf(request)
    if (!admin) {
      response.status(401).json({ error: 'unauthenticated' })
      return
    }
    const body = (request.body ?? {}) as Record<string, unknown>
    const profile = (body.profile ?? {}) as { name?: unknown; color?: unknown }
    const name = cleanHouseholdName(body.name)
    const profileName = cleanName(profile.name)
    const color = profileColorOf(profile.color)
    const timeZone = timeZoneOf(body.timeZone)
    const country = countryOf(body.country)
    const language = body.language === undefined ? 'fr' : isLanguage(body.language) ? body.language : null
    const ai = body.ai === null || body.ai === undefined ? null : aiOf(providers, body.ai)
    if (!name || !profileName || !color || timeZone === false || country === false || !language || (body.ai && !ai)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    const settings: HouseholdAi | null = ai ? { provider: ai.provider.id, key: ai.key, model: null } : null
    if (
      !household.setUp({ name, timeZone: timeZone ?? null, country: country ?? null, language, ai: settings }, now())
    ) {
      response.status(409).json({ error: 'already_set_up' })
      return
    }
    householdLater?.set(false)
    // The install's first profile becomes the one set up here, its admin, and the server admin's own.
    const first = profiles.list().find(candidate => candidate.role === 'admin')
    if (first) {
      profiles.update(first.id, { name: profileName, color })
      profiles.tourTaken(first.id)
      accounts?.linkProfile(admin.id, first.id)
      const lock = profiles.lock(first.id)
      response.set('Set-Cookie', profileCookie(profileToken(first.id, lock?.version ?? 0, secret)))
    }
    onSetUp(language)
    onChange()
    response.json({ profileId: first?.id ?? null })
  })
}
