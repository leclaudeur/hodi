// Sources that every profile turned off: nobody reads them, so their feeds are not fetched.
// Asked often (each list), so the answer is kept a minute.
export const createPauseCheck = ({
  hiddenByProfile,
  now,
  ttlMs = 60 * 1000
}: {
  // Each profile's hidden sources.
  hiddenByProfile: () => string[][]
  now: () => number
  ttlMs?: number
}) => {
  let paused = new Set<string>()
  let checkedAt = -Infinity
  return (sourceId: string) => {
    if (now() - checkedAt > ttlMs) {
      const lists = hiddenByProfile()
      paused =
        lists.length === 0 ? new Set() : new Set(lists[0]!.filter(id => lists.every(hidden => hidden.includes(id))))
      checkedAt = now()
    }
    return paused.has(sourceId)
  }
}
