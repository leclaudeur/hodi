import { isIP } from 'node:net'
import type express from 'express'
import type { AiProvider } from '../news/ai-providers.ts'
import { isTimeZone } from '../news/days.ts'

// What the first-run screens and Réglages > Foyer accept: passwords, region, the AI's key.

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 256
const MAX_KEY_LENGTH = 300

export const isPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH

const isCountry = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{2}$/.test(value)

// undefined: not sent; null: none; false: wrong.
export const countryOf = (value: unknown) =>
  value === undefined || value === null ? value : isCountry(value) ? value : false

export const timeZoneOf = (value: unknown) =>
  value === undefined || value === null ? value : typeof value === 'string' && isTimeZone(value) ? value : false

// The provider and the key as sent, when they look right.
export const aiOf = (providers: AiProvider[], body: unknown): { provider: AiProvider; key: string } | null => {
  const { provider: id, key } = (body ?? {}) as { provider?: unknown; key?: unknown }
  const provider = providers.find(candidate => candidate.id === id)
  if (!provider || typeof key !== 'string') return null
  const trimmed = key.trim()
  return trimmed.length <= MAX_KEY_LENGTH && provider.keyPattern.test(trimmed) ? { provider, key: trimmed } : null
}

// The end of a key, enough to tell two apart.
export const keyHint = (key: string) =>
  `${key.slice(0, key.indexOf('-', 3) + 1) || key.slice(0, 3)}••••${key.slice(-4)}`

const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./]

// A device on this computer or its home network, not through a proxy: it may set up the install without the
// code. A server behind a proxy (Caddy and the like) adds a forwarding header, so its visitors need the code.
export const isNearby = (request: express.Request) => {
  if (request.get('x-forwarded-for') || request.get('forwarded') || request.get('x-real-ip')) return false
  const address = (request.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  if (isIP(address) === 4) return PRIVATE_V4.some(range => range.test(address))
  return address === '::1' || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)
}

export const providersList = (providers: AiProvider[]) =>
  providers.map(({ id, name, keysUrl }) => ({ id, name, keysUrl }))
