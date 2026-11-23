import { currentHouseholdId } from '../db/household-scope.ts'
import type { YouthSources } from '../news/youth-sources.ts'
import type { Options } from './wiring.ts'

// A new adult starts with the base sources in « Mes sources », or keeps its account's list. Also called once the
// catalogue is filled at setup, for the first adult made before it.
export const giveBaseSources = ({ users, news, now }: Options, id: number) => {
  const user = users?.(id)
  if (!user || user.sources.any()) return
  const base = news.getSourceStatuses().filter(source => source.addedBy === undefined)
  user.sources.add(
    base.map(source => source.id),
    now()
  )
}

export interface ProfileHooks {
  created: (id: number) => void
  deleted: (id: number) => void
}

export const profileHooksOf = (options: Options, youthSources: YouthSources | null): ProfileHooks => {
  const { news, alerts, plugins, profiles } = options
  return {
    // A young one starts with its kind's base sources only.
    created: id => {
      const profile = profiles?.get(id)
      if (!profile) return
      if (profile.kind === 'adult') giveBaseSources(options, id)
      youthSources?.start(profile)
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
