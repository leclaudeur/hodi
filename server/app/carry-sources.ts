import type { Options } from './wiring.ts'

// An account joining a household: the sources it had on in its last one come back, added to this household when it
// does not follow them yet (off for its other profiles, as any source added). Every other source someone added here
// is off for it, as for a new profile: the account's preferences may come from another household.
export const carrySourcesOf =
  (
    { sources, news, users, profiles, serverSettings, now }: Options,
    hideSources: (id: number, ids: string[]) => void
  ) =>
  (profileId: number) => {
    if (!sources || !users) return
    const store = sources.store
    const kept = new Set<string>()
    for (const { source, section, sectionIds } of sources.carried?.take(profileId) ?? []) {
      const followed = store.has(source.id) ? source.id : store.findByUrl(source.url)?.id
      if (followed) {
        kept.add(followed)
        continue
      }
      const max = serverSettings?.maxSources() ?? null
      const added = { ...source, addedBy: profileId }
      if ((max !== null && store.count() >= max) || !news.addSource(added, section, sectionIds)) continue
      store.add(added, section, sectionIds, now())
      profiles
        ?.list()
        .filter(profile => profile.id !== profileId)
        .forEach(profile => hideSources(profile.id, [source.id]))
      kept.add(source.id)
    }
    const others = news
      .getSourceStatuses()
      .filter(status => status.addedBy !== undefined && !kept.has(status.id))
      .map(status => status.id)
    const user = users(profileId)
    const hidden = [...new Set([...user.hiddenSources(), ...others])].filter(id => !kept.has(id))
    user.setPreferences({ hiddenSources: hidden }, now())
  }
