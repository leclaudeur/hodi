import { currentHouseholdId } from '../db/household-scope.ts'
import type { YouthSources } from '../news/youth-sources.ts'
import type { Options } from './wiring.ts'

export interface ProfileHooks {
  created: (id: number) => void
  deleted: (id: number) => void
  // Turns sources off in a profile's preferences, on the server: its devices get the change with the state.
  hideSources: (profileId: number, ids: string[]) => void
}

export const profileHooksOf = (
  { users, news, alerts, plugins, profiles, now }: Options,
  youthSources: YouthSources | null
): ProfileHooks => {
  const hideSources = (profileId: number, ids: string[]) => {
    if (!users || ids.length === 0) return
    const user = users(profileId)
    const hidden = user.hiddenSources()
    const added = ids.filter(id => !hidden.includes(id))
    if (added.length > 0) user.setPreferences({ hiddenSources: [...hidden, ...added] }, now())
  }
  return {
    hideSources,
    // A new profile starts with the base sources: the ones profiles added are off until it turns them on. A young one
    // starts with its kind's base sources only.
    created: id => {
      hideSources(
        id,
        news
          .getSourceStatuses()
          .filter(source => source.addedBy !== undefined)
          .map(source => source.id)
      )
      const profile = profiles?.get(id)
      if (profile) youthSources?.start(profile)
    },
    // Its devices' alerts go with a deleted profile, and the sources it added (the database removes their rows).
    deleted: id => {
      alerts?.unregisterProfile(id)
      // The plugins forget it too, now or as soon as they can.
      plugins?.profileDeleted(id, currentHouseholdId())
      news
        .getSourceStatuses()
        .filter(source => source.addedBy === id)
        .forEach(source => news.removeSource(source.id))
    }
  }
}
