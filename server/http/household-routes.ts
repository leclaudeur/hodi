import { isIP } from 'node:net'
import express from 'express'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword, verifyPassword } from '../auth/password.ts'
import { createSessionToken, profileCookie, profileToken, sessionCookie, sessionKey } from '../auth/session.ts'
import { type HouseholdAi, type HouseholdStore, cleanHouseholdName, isHourCycle } from '../db/household-store.ts'
import { PROFILE_COLORS, type ProfileColor, type ProfileStore, cleanName } from '../db/profile-store.ts'
import { type Language, isLanguage } from '../../shared/i18n.ts'
import type { AiProvider } from '../news/ai-providers.ts'
import { isTimeZone } from '../news/days.ts'
import { clientAddressOf } from './client-address.ts'

// The household: made once in the first-run screens, then the admin's in Réglages > Foyer and > IA et crédits.

export const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 256
const MAX_KEY_LENGTH = 300

const isPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH

const isCountry = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{2}$/.test(value)

// undefined: not sent; null: none; false: wrong.
const countryOf = (value: unknown) => (value === undefined || value === null ? value : isCountry(value) ? value : false)

const timeZoneOf = (value: unknown) =>
  value === undefined || value === null ? value : typeof value === 'string' && isTimeZone(value) ? value : false

// The provider and the key as sent, when they look right.
const aiOf = (providers: AiProvider[], body: unknown): { provider: AiProvider; key: string } | null => {
  const { provider: id, key } = (body ?? {}) as { provider?: unknown; key?: unknown }
  const provider = providers.find(candidate => candidate.id === id)
  if (!provider || typeof key !== 'string') return null
  const trimmed = key.trim()
  return trimmed.length <= MAX_KEY_LENGTH && provider.keyPattern.test(trimmed) ? { provider, key: trimmed } : null
}

// The end of a key, enough to tell two apart.
const keyHint = (key: string) => `${key.slice(0, key.indexOf('-', 3) + 1) || key.slice(0, 3)}••••${key.slice(-4)}`

const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./]

// A device on this computer or its home network, not through a proxy: it may set up the install without the
// code. A server behind a proxy (Caddy and the like) adds a forwarding header, so its visitors need the code.
export const isNearby = (request: express.Request) => {
  if (request.get('x-forwarded-for') || request.get('forwarded') || request.get('x-real-ip')) return false
  const address = (request.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  if (isIP(address) === 4) return PRIVATE_V4.some(range => range.test(address))
  return address === '::1' || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)
}

const providersList = (providers: AiProvider[]) => providers.map(({ id, name, keysUrl }) => ({ id, name, keysUrl }))

export interface HouseholdRoutesOptions {
  household: HouseholdStore
  profiles: ProfileStore
  providers: AiProvider[]
  now: () => number
  secret: Buffer
  // The server's own time zone, when the household has none.
  defaultTimeZone: string
  // Six digits written in the server's log on a start before setup; asked of devices that are not nearby.
  setupCode: string
  throttle: LoginThrottle
  // Region or AI changed: the news service takes the new ones.
  onChange: () => void
  // The household now exists, in this language: its base sources come in.
  onSetUp?: (language: Language) => void
}

// Before the session check: what the login and first-run screens need, and the setup itself.
export const setupRoutes = ({
  household,
  profiles,
  providers,
  now,
  secret,
  setupCode,
  throttle,
  onChange,
  onSetUp = () => {}
}: HouseholdRoutesOptions) => {
  const router = express.Router()

  // The code, when this device needs one. False sends the answer.
  const codeOk = (request: express.Request, response: express.Response) => {
    if (isNearby(request)) return true
    const client = clientAddressOf(request)
    const decision = throttle.check(now(), client)
    if (!decision.allowed) {
      response.set('Retry-After', String(decision.retryAfterSeconds))
      response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
      return false
    }
    if (request.body?.code !== setupCode) {
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

  router.get('/', (request, response) => {
    const needed = !household.isSetUp()
    response.json(
      needed
        ? { needed, codeRequired: !isNearby(request), providers: providersList(providers) }
        : { needed, name: household.get().name, language: household.get().language }
    )
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

  router.post('/', async (request, response) => {
    if (notNeeded(response) || !codeOk(request, response)) return
    const body = (request.body ?? {}) as Record<string, unknown>
    const profile = (body.profile ?? {}) as { name?: unknown; color?: unknown }
    const name = cleanHouseholdName(body.name)
    const profileName = cleanName(profile.name)
    const color = PROFILE_COLORS.includes(profile.color as ProfileColor) ? (profile.color as ProfileColor) : null
    const timeZone = timeZoneOf(body.timeZone)
    const country = countryOf(body.country)
    // Optional, for a first-run screen from before languages: French then.
    const language = body.language === undefined ? 'fr' : isLanguage(body.language) ? body.language : null
    const ai = body.ai === null || body.ai === undefined ? null : aiOf(providers, body.ai)
    if (
      !name ||
      !isPassword(body.password) ||
      !profileName ||
      !color ||
      timeZone === false ||
      country === false ||
      !language ||
      (body.ai && !ai)
    ) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    const passwordHash = await hashPassword(body.password)
    const settings: HouseholdAi | null = ai ? { provider: ai.provider.id, key: ai.key, model: null } : null
    if (
      !household.setUp(
        { name, passwordHash, timeZone: timeZone ?? null, country: country ?? null, language, ai: settings },
        now()
      )
    ) {
      response.status(409).json({ error: 'already_set_up' })
      return
    }
    // The install's first profile becomes the one set up here, its admin.
    const admin = profiles.list().find(candidate => candidate.role === 'admin')
    if (admin) {
      profiles.update(admin.id, { name: profileName, color })
      profiles.tourTaken(admin.id)
      const lock = profiles.lock(admin.id)
      response.set('Set-Cookie', [
        sessionCookie(createSessionToken(sessionKey(secret, passwordHash), now())),
        profileCookie(profileToken(admin.id, lock?.version ?? 0, secret))
      ])
    }
    onSetUp(language)
    onChange()
    response.json({ profileId: admin?.id ?? null })
  })

  return router
}

// After the session and profile checks, the admin's only: Réglages > Foyer and the AI's provider and key.
export const householdRoutes = ({
  household,
  providers,
  now,
  secret,
  defaultTimeZone,
  throttle,
  onChange
}: HouseholdRoutesOptions) => {
  const router = express.Router()

  const view = () => {
    const current = household.get()
    const provider = providers.find(candidate => candidate.id === current.ai?.provider)
    return {
      name: current.name,
      passwordChangedAt: current.passwordChangedAt,
      timeZone: current.timeZone ?? defaultTimeZone,
      country: current.country,
      language: current.language,
      hourCycle: current.hourCycle,
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

  // Every other device signs in again; this one gets a new cookie.
  router.put('/password', async (request, response) => {
    const { current, next } = (request.body ?? {}) as { current?: unknown; next?: unknown }
    const hash = household.get().passwordHash
    if (typeof current !== 'string' || current.length > MAX_PASSWORD_LENGTH || !isPassword(next) || !hash) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const decision = throttle.check(now())
    if (!decision.allowed) {
      response.set('Retry-After', String(decision.retryAfterSeconds))
      response.status(429).json({ error: 'too_many_attempts', retryAfterSeconds: decision.retryAfterSeconds })
      return
    }
    if (!(await verifyPassword(current, hash))) {
      throttle.recordFailure(now())
      // Not 401: this device's session is fine, only the password typed is wrong.
      response.status(403).json({ error: 'invalid_password' })
      return
    }
    const passwordHash = await hashPassword(next)
    household.setPassword(passwordHash, now())
    const key = sessionKey(secret, passwordHash, household.get().sessionGeneration)
    response.set('Set-Cookie', sessionCookie(createSessionToken(key, now())))
    response.json(view())
  })

  // "Déconnecter les autres appareils": every session but this device's, which gets a new cookie.
  router.post('/sessions/revoke', (_request, response) => {
    const hash = household.get().passwordHash
    if (!hash) {
      response.status(409).json({ error: 'setup_required' })
      return
    }
    const generation = household.revokeSessions()
    response.set('Set-Cookie', sessionCookie(createSessionToken(sessionKey(secret, hash, generation), now())))
    response.status(204).end()
  })

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

  return router
}
