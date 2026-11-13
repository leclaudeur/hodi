import ipaddr from 'ipaddr.js'

// Limits on failed logins. Each client has its own small allowance, so bots trying passwords from the internet
// do not lock the household out of signing in on a new device; a much larger limit shared by every client still
// caps a guessing attempt spread over many addresses. Existing sessions keep working either way.
export const DEFAULT_MAX_FAILURES = 10
export const DEFAULT_WINDOW_MS = 15 * 60 * 1000
export const DEFAULT_GLOBAL_MAX_FAILURES = 100
// Past this many clients with recent failures, the oldest are forgotten (their failures still count globally).
const MAX_CLIENTS = 10_000

// An IPv6 address counts by its /64: one connection usually holds a whole /64, and each of its addresses must not get
// an allowance of its own.
export const clientKey = (client: string) => {
  if (!ipaddr.IPv6.isValid(client)) return client
  const parsed = ipaddr.process(client)
  if (parsed.kind() === 'ipv4') return parsed.toString()
  return `${(parsed as ipaddr.IPv6).parts
    .slice(0, 4)
    .map(part => part.toString(16))
    .join(':')}::/64`
}

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }

export class LoginThrottle {
  readonly #maxFailures: number
  readonly #windowMs: number
  readonly #globalMaxFailures: number
  #failures = new Map<string, number[]>()
  #global: number[] = []

  constructor(
    maxFailures = DEFAULT_MAX_FAILURES,
    windowMs = DEFAULT_WINDOW_MS,
    globalMaxFailures = DEFAULT_GLOBAL_MAX_FAILURES
  ) {
    this.#maxFailures = maxFailures
    this.#windowMs = windowMs
    this.#globalMaxFailures = Math.max(globalMaxFailures, maxFailures)
  }

  // client: the address the attempt comes from; without one, every attempt shares a single allowance.
  check(nowMs: number, client = ''): ThrottleDecision {
    this.#prune(nowMs)
    return (
      this.#refusal(this.#failures.get(clientKey(client)) ?? [], this.#maxFailures, nowMs) ??
      this.#refusal(this.#global, this.#globalMaxFailures, nowMs) ?? { allowed: true }
    )
  }

  // Failures are never cleared by a successful login, so a correct guess
  // does not hand an attacker a fresh set of attempts.
  recordFailure(nowMs: number, rawClient = '') {
    this.#prune(nowMs)
    const client = clientKey(rawClient)
    const failures = this.#failures.get(client) ?? []
    failures.push(nowMs)
    // Re-inserted, so the map stays ordered from the least to the most recently failing client.
    this.#failures.delete(client)
    this.#failures.set(client, failures)
    this.#global.push(nowMs)
    for (const oldest of this.#failures.keys()) {
      if (this.#failures.size <= MAX_CLIENTS) break
      this.#failures.delete(oldest)
    }
  }

  #refusal(failures: number[], max: number, nowMs: number): ThrottleDecision | null {
    const oldest = failures[failures.length - max]
    if (failures.length < max || oldest === undefined) return null
    return { allowed: false, retryAfterSeconds: Math.ceil((oldest + this.#windowMs - nowMs) / 1000) }
  }

  #prune(nowMs: number) {
    const recent = (time: number) => nowMs - time < this.#windowMs
    this.#global = this.#global.filter(recent)
    for (const [client, failures] of this.#failures) {
      const kept = failures.filter(recent)
      if (kept.length === 0) this.#failures.delete(client)
      else this.#failures.set(client, kept)
    }
  }
}
