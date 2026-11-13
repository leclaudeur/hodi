import { noteResponse } from '../lib/connection.ts'
import { type SignInRefusal, refusalOf } from '../lib/sign-in-refusal.ts'

// Thrown when the session expired: the app goes back to the login page.
export class UnauthorizedError extends Error {}

// Sent on window when the server answers that this device's profile is closed: the app goes back to « Qui lit ? ».
export const PROFILE_CLOSED = 'hodi:profile-closed'
const noteProfileClosed = async (response: Response) => {
  if (response.status !== 403) return
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: string } | null
  if (body?.error === 'profile_locked') window.dispatchEvent(new Event(PROFILE_CLOSED))
}

export const getJson = async <T>(route: string, accept: number[] = []): Promise<T> => {
  const response = await fetch(`/api${route}`)

  if (response.status === 401) {
    throw new UnauthorizedError('Session expired')
  }
  await noteProfileClosed(response)

  if (!response.ok && !accept.includes(response.status)) {
    throw new Error(`GET ${route} failed with status ${response.status}`)
  }

  noteResponse(response)
  return (await response.json()) as T
}

export const sendJson = async <T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', route: string, body?: unknown) => {
  const response = await fetch(`/api${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  await noteProfileClosed(response)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; retryAfterSeconds?: number } | null
    throw new RequestError(response.status, body?.error ?? null, body?.retryAfterSeconds ?? null, refusalOf(body))
  }
  return (response.status === 204 ? null : await response.json()) as T
}

// A refused request and the server's reason: 'wrong_password', 'too_many_attempts'…
export class RequestError extends Error {
  readonly status: number
  readonly code: string | null
  readonly retryAfterSeconds: number | null
  // A plugin refused the sign-in ('sign_in_refused').
  readonly refusal: SignInRefusal | null

  constructor(
    status: number,
    code: string | null,
    retryAfterSeconds: number | null,
    refusal: SignInRefusal | null = null
  ) {
    super(`Request failed with status ${status}${code ? ` (${code})` : ''}`)
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.refusal = refusal
  }
}
