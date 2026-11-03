import { createHmac, timingSafeEqual } from 'node:crypto'

// Sessions are stateless signed tokens so nothing is stored on the server.
// Token format: v1.<expiry in epoch seconds>.<HMAC-SHA256 signature in base64url>.
const VERSION = 'v1'

export const SESSION_COOKIE = 'hodi_session'
export const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60

const sign = (payload: string, secret: Buffer) => createHmac('sha256', secret).update(payload).digest('base64url')

// The key sessions are signed with: the server's secret bound to the household's password and its session
// generation, so a new password or "Déconnecter les autres appareils" signs out every device but the one that did
// it (given a new cookie). Generation 0 keeps the key sessions had before generations existed.
export const sessionKey = (secret: Buffer, passwordHash: string, generation = 0) =>
  createHmac('sha256', secret)
    .update(generation === 0 ? `session.${passwordHash}` : `session.${passwordHash}.${generation}`)
    .digest()

export const createSessionToken = (secret: Buffer, nowMs: number, ttlSeconds = SESSION_TTL_SECONDS) => {
  const payload = `${VERSION}.${Math.floor(nowMs / 1000) + ttlSeconds}`
  return `${payload}.${sign(payload, secret)}`
}

export const verifySessionToken = (token: string, secret: Buffer, nowMs: number) => {
  const [version, expiry, signature] = token.split('.')

  if (version !== VERSION || !expiry || !signature || !/^\d+$/.test(expiry)) {
    return false
  }

  const expected = Buffer.from(sign(`${version}.${expiry}`, secret))
  const received = Buffer.from(signature)

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return false
  }

  return Number(expiry) * 1000 > nowMs
}

export const readCookie = (header: string | undefined, name: string) => {
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=')

    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim()
    }
  }

  return undefined
}

// Secure cookies still work on http://localhost, which browsers treat as a secure context.
const COOKIE_ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Lax'

export const sessionCookie = (token: string) =>
  `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_TTL_SECONDS}; ${COOKIE_ATTRIBUTES}`

export const clearedSessionCookie = () => `${SESSION_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`

// The profile open on this device ("Qui lit ?"): <id>.<signature>, the signature covering the profile's PIN
// version, so a profile with a PIN opens only on a device that gave it (and gave the current one).
// A plain id, from before PINs, still opens a profile without one.
export const PROFILE_COOKIE = 'hodi_profile'

const profilePayload = (id: number, pinVersion: number) => `profile.${id}.${pinVersion}`

export const profileToken = (id: number, pinVersion: number, secret: Buffer) =>
  `${id}.${sign(profilePayload(id, pinVersion), secret)}`

// The profile id a cookie names, and whether its signature holds for that PIN version.
export const readProfileToken = (token: string | undefined, secret: Buffer, pinVersionOf: (id: number) => number) => {
  const [rawId, signature] = (token ?? '').split('.')
  const id = Number(rawId)
  if (!rawId || !Number.isInteger(id)) return null
  if (!signature) return { id, signed: false }
  const expected = Buffer.from(sign(profilePayload(id, pinVersionOf(id)), secret))
  const received = Buffer.from(signature)
  return { id, signed: expected.length === received.length && timingSafeEqual(expected, received) }
}

export const profileCookie = (token: string) =>
  `${PROFILE_COOKIE}=${token}; Max-Age=${SESSION_TTL_SECONDS}; ${COOKIE_ATTRIBUTES}`

export const clearedProfileCookie = () => `${PROFILE_COOKIE}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`
