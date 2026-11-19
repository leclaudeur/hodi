import type { Database } from '../db/database.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import type { SourceStore } from '../db/source-store.ts'
import { UserStore } from '../db/user-store.ts'
import { hideSourcesOf, otherBasesOf } from '../news/base-sources.ts'
import type { Catalog } from '../news/catalog.ts'
import { isLanguage } from '../../shared/i18n.ts'

// Once, on a household set up when only its language's base sources came in: the other languages' come too, off for
// every profile that reads in another language. Before the catalogue is read, so that the news start with them.
export const followEveryBase = (
  db: Database,
  {
    sources,
    file,
    household,
    profiles
  }: { sources: SourceStore; file: Catalog; household: HouseholdStore; profiles: ProfileStore },
  now: number
) => {
  if (!household.isSetUp()) return
  const fallback = household.get().language
  const added = sources.followEveryBase(file, fallback, now)
  if (added.length === 0) return
  for (const profile of profiles.list()) {
    const user = new UserStore(db, profile.id)
    const own = user.preferences()?.language
    const off = otherBasesOf(file, isLanguage(own) ? own : fallback).filter(id => added.includes(id))
    hideSourcesOf(user, off, now)
  }
}
