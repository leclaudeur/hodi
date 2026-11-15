// Who has Hodi open right now, for Serveur › Vue d'ensemble: kept in memory only, gone at the next restart, never
// written anywhere. A profile counts as online for a few minutes after its last request.

const ONLINE_MS = 5 * 60 * 1000

export type DeviceKind = 'phone' | 'tablet' | 'computer'

// The kind of device, from its browser's own name: nothing more is kept of it.
export const deviceKindOf = (userAgent: string): DeviceKind =>
  /iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)
    ? 'tablet'
    : /Mobile|iPhone|Android/i.test(userAgent)
      ? 'phone'
      : 'computer'

interface Seen {
  profileId: number
  device: DeviceKind
  // When this stretch online began, and the last request of it.
  since: number
  last: number
}

export class Presence {
  readonly #seen = new Map<string, Seen>()

  seen(profileId: number, userAgent: string, now: number) {
    const device = deviceKindOf(userAgent)
    const key = `${profileId}:${device}`
    const before = this.#seen.get(key)
    const since = before && now - before.last < ONLINE_MS ? before.since : now
    this.#seen.set(key, { profileId, device, since, last: now })
  }

  // The profiles online now, the longest there first.
  online(now: number) {
    for (const [key, entry] of this.#seen) if (now - entry.last >= ONLINE_MS) this.#seen.delete(key)
    return [...this.#seen.values()]
      .sort((a, b) => a.since - b.since)
      .map(({ profileId, device, since }) => ({ profileId, device, since }))
  }
}
