import { currentHouseholdId } from '../db/household-scope.ts'
import { hideSourcesOf, otherBasesOf } from '../news/base-sources.ts'
import type { Language } from '../news/catalog.ts'
import type { YouthSources } from '../news/youth-sources.ts'
import type { Options } from './wiring.ts'

// Who a new profile comes from: the language its person chose (« J'ai un code »), else the one of the profile that
// made it (a parent's for a young profile), else the household's.
export interface CreatedFrom {
  language?: Language | null
  creator?: number
}

export interface ProfileHooks {
  created: (id: number, from?: CreatedFrom) => void
  deleted: (id: number) => void
  // Turns sources off in a profile's preferences, on the server: its devices get the change with the state.
  hideSources: (profileId: number, ids: string[]) => void
  // The base sources of another language than the profile's: off.
  hideOtherBases: (profileId: number) => void
}

export const profileHooksOf = (
  { users, news, alerts, plugins, profiles, sources, now }: Options,
  youthSources: YouthSources | null
): ProfileHooks => {
  const hideSources = (profileId: number, ids: string[]) => {
    if (users && ids.length > 0) hideSourcesOf(users(profileId), ids, now())
  }
  const hideOtherBases = (profileId: number) => {
    if (sources) hideSources(profileId, otherBasesOf(sources.file, news.languageOf(profileId)))
  }
  return {
    hideSources,
    hideOtherBases,
    // A new profile starts with the base sources of its language: the ones profiles added are off until it turns them
    // on. A young one starts with its kind's base sources only.
    created: (id, { language, creator } = {}) => {
      const own = language ?? (creator === undefined ? null : news.languageOf(creator))
      if (own && users) users(id).setPreferences({ language: own }, now())
      hideSources(
        id,
        news
          .getSourceStatuses()
          .filter(source => source.addedBy !== undefined)
          .map(source => source.id)
      )
      hideOtherBases(id)
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
