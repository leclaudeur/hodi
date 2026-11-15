import { createHmac, timingSafeEqual } from 'node:crypto'

// Sessions are stateless signed tokens so nothing is stored on the server.
// Token format: v1.<expiry in epoch seconds>.<HMAC-SHA256 signature in base64url>.
const VERSION = 'v1'

export const SESSION_COOKIE = 'hodi_session'
export const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60

const sign = (payload: string, secret: Buffer) => createHmac('sha256', secret).update(payload).digest('base64url')

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

// A personal account's session: v2.<account id>.<expiry in epoch seconds>.<signature>. Its key binds the account's
// session generation, which a new password and "Déconnecter les autres appareils" both raise: either signs out every
// device of that account and no one else's. The password hash stays out of it, so that a hash made stronger at sign-in
// signs no device out and no older, weaker hash has to be kept. (Sessions signed when the key held the hash no longer
// hold: every device signed in once again after that change.)
const USER_VERSION = 'v2'

export const userSessionKey = (secret: Buffer, userId: number, generation: number) =>
  createHmac('sha256', secret).update(`user.${userId}.${generation}`).digest()

export const createUserSessionToken = (
  userId: number,
  key: Buffer,
  nowMs: number,
  ttlSeconds = SESSION_TTL_SECONDS
) => {
  const payload = `${USER_VERSION}.${userId}.${Math.floor(nowMs / 1000) + ttlSeconds}`
  return `${payload}.${sign(payload, key)}`
}

// The account a token names, before its signature is checked: the key to check it with depends on the account.
export const userIdOfToken = (token: string) => {
  const [version, id] = token.split('.')
  return version === USER_VERSION && id && /^\d+$/.test(id) ? Number(id) : null
}

// The account id when the token is one of its sessions and has not expired; null otherwise.
export const verifyUserSessionToken = (token: string, keyOf: (userId: number) => Buffer | null, nowMs: number) => {
  const [version, id, expiry, signature] = token.split('.')
  const userId = userIdOfToken(token)
  if (version !== USER_VERSION || userId === null || !expiry || !signature || !/^\d+$/.test(expiry)) return null
  const key = keyOf(userId)
  if (!key) return null
  const expected = Buffer.from(sign(`${version}.${id}.${expiry}`, key))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null
  return Number(expiry) * 1000 > nowMs ? userId : null
}

// A device's session, since Réglages > Compte et données lists them: v3.<account id>.<device id>.<expiry>.<signature>,
// signed with the same key as v2. A v2 token, from before devices were kept, still signs in; the app then gives that
// device a v3 one.
const DEVICE_VERSION = 'v3'

export const createDeviceSessionToken = (
  userId: number,
  deviceId: number,
  key: Buffer,
  nowMs: number,
  ttlSeconds = SESSION_TTL_SECONDS
) => {
  const payload = `${DEVICE_VERSION}.${userId}.${deviceId}.${Math.floor(nowMs / 1000) + ttlSeconds}`
  return `${payload}.${sign(payload, key)}`
}

// When a token of SESSION_TTL_SECONDS was made, from its expiry: rows made after it (an account or a device given
// the id of one deleted since, as SQLite does) are not the ones it was made for.
const issuedAtOf = (expiry: string) => (Number(expiry) - SESSION_TTL_SECONDS) * 1000

// The account and, for a v3 token, the device it names, once its signature holds and it has not expired, with when
// it was made.
export const verifyAccountToken = (
  token: string,
  keyOf: (userId: number) => Buffer | null,
  nowMs: number
): { userId: number; deviceId: number | null; issuedAt: number } | null => {
  const parts = token.split('.')
  if (parts[0] === USER_VERSION) {
    const userId = verifyUserSessionToken(token, keyOf, nowMs)
    return userId === null ? null : { userId, deviceId: null, issuedAt: issuedAtOf(parts[2]!) }
  }
  const [version, id, device, expiry, signature] = parts
  if (
    version !== DEVICE_VERSION ||
    parts.length !== 5 ||
    ![id, device, expiry].every(part => /^\d+$/.test(part ?? ''))
  ) {
    return null
  }
  const key = keyOf(Number(id))
  if (!key || !signature) return null
  const expected = Buffer.from(sign(`${version}.${id}.${device}.${expiry}`, key))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null
  return Number(expiry) * 1000 > nowMs
    ? { userId: Number(id), deviceId: Number(device), issuedAt: issuedAtOf(expiry!) }
    : null
}

// A young profile's own device, linked with a code: y2.<device>.<its row's creation time>.<signature>. No expiry in
// it: the device stays linked while its row does (see ProfileDeviceStore), and its cookie is sent again as it is
// used. The creation time tells that row from a later one SQLite gave the same id. y1.<device>.<signature>, from
// before, names the id alone.
const PROFILE_DEVICE_VERSION = 'y2'
const LEGACY_PROFILE_DEVICE_VERSION = 'y1'

const profileDeviceKey = (secret: Buffer) => createHmac('sha256', secret).update('profile-device').digest()

export const createProfileDeviceToken = (deviceId: number, createdAt: number, secret: Buffer) => {
  const payload = `${PROFILE_DEVICE_VERSION}.${deviceId}.${createdAt}`
  return `${payload}.${sign(payload, profileDeviceKey(secret))}`
}

// The device a y2 token names with its creation time, or a y1 token with none (null), once its signature holds;
// null for any other token.
export const readProfileDeviceToken = (token: string, secret: Buffer) => {
  const parts = token.split('.')
  const legacy = parts[0] === LEGACY_PROFILE_DEVICE_VERSION && parts.length === 3
  if (!legacy && !(parts[0] === PROFILE_DEVICE_VERSION && parts.length === 4)) return null
  const fields = parts.slice(1, -1)
  const signature = parts.at(-1)
  if (!fields.every(field => /^\d+$/.test(field)) || !signature) return null
  const expected = Buffer.from(sign(parts.slice(0, -1).join('.'), profileDeviceKey(secret)))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null
  return { id: Number(fields[0]), createdAt: legacy ? null : Number(fields[1]) }
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

const profilePayload = (id: number, pinVersion: number | string) => `profile.${id}.${pinVersion}`

export const profileToken = (id: number, pinVersion: number | string, secret: Buffer) =>
  `${id}.${sign(profilePayload(id, pinVersion), secret)}`

// The profile id a cookie names, and whether its signature holds for that PIN version.
export const readProfileToken = (
  token: string | undefined,
  secret: Buffer,
  pinVersionOf: (id: number) => number | string
) => {
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
