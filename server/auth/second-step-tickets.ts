import { randomBytes } from 'node:crypto'

// A plugin vouched for an account whose « Validation en deux étapes » is on (« Se connecter avec Google », its
// password checked by the plugin): the device signs in only once the person types the app's code in Hodi's own dialog.
// The ticket stands for that first step: random, kept in memory only, good for a few minutes and a few codes, used once.

export const SECOND_STEP_MS = 5 * 60 * 1000
export const SECOND_STEP_TRIES = 5
// The most tickets waiting at once: past it, the oldest goes.
const MAX_TICKETS = 1000

export class SecondStepTickets {
  #tickets = new Map<string, { accountId: number; expires: number; tries: number }>()

  issue(accountId: number, now: number) {
    this.#forgetExpired(now)
    if (this.#tickets.size >= MAX_TICKETS) this.#tickets.delete(this.#tickets.keys().next().value!)
    const ticket = randomBytes(32).toString('base64url')
    this.#tickets.set(ticket, { accountId, expires: now + SECOND_STEP_MS, tries: 0 })
    return ticket
  }

  // The account a ticket still stands for, or null.
  accountOf(ticket: unknown, now: number) {
    if (typeof ticket !== 'string') return null
    const entry = this.#tickets.get(ticket)
    if (!entry) return null
    if (entry.expires <= now) {
      this.#tickets.delete(ticket)
      return null
    }
    return entry.accountId
  }

  // A wrong code: after a few, the ticket is gone and the person starts the sign-in again.
  failed(ticket: string) {
    const entry = this.#tickets.get(ticket)
    if (entry && ++entry.tries >= SECOND_STEP_TRIES) this.#tickets.delete(ticket)
  }

  use(ticket: string) {
    this.#tickets.delete(ticket)
  }

  #forgetExpired(now: number) {
    for (const [ticket, { expires }] of this.#tickets) if (expires <= now) this.#tickets.delete(ticket)
  }
}
