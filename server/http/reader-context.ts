import type express from 'express'
import type { ProfileStore } from '../db/profile-store.ts'
import type { UserStore } from '../db/user-store.ts'
import { type NewsService } from '../news/news-service.ts'
import { NO_FILTER, readerFilterOf } from '../news/reader-filter.ts'
import { youthFilter } from '../news/youth-filter.ts'
import type { YouthSources } from '../news/youth-sources.ts'
import { kindOf, profileIdOf } from './profile-routes.ts'

// What the profile asking may read, and in which language: the lists and articles routes cut to it.
export const readerContext = ({
  news,
  users,
  profiles,
  youthSources
}: {
  news: NewsService
  users?: (profileId: number) => UserStore
  profiles?: ProfileStore
  youthSources: YouthSources | null
}) => {
  // What a young profile's parents did not turn on; null for an adult.
  const youthLockOf = (response: express.Response) => {
    const profile = profiles?.get(profileIdOf(response))
    return profile && youthSources ? youthSources.lock(profile) : null
  }
  // Its lists and articles, cut to that.
  const youthFilterOf = (response: express.Response) => {
    const lock = youthLockOf(response)
    return lock ? youthFilter(lock) : null
  }
  // What the profile turned off, for the lists the server picks from (À la une, trends, Résumé du jour).
  const filterOf = (response: express.Response) => {
    const own = users ? readerFilterOf(users(profileIdOf(response)).preferences()) : NO_FILTER
    const lock = youthLockOf(response)
    return lock
      ? {
          ...own,
          hiddenSources: [...new Set([...own.hiddenSources, ...lock.hiddenSources])],
          hiddenTopics: [...new Set([...own.hiddenTopics, ...lock.hiddenTopics])]
        }
      : own
  }
  // Topic names come in the profile's language.
  const languageOf = (response: express.Response) => news.languageOf(profileIdOf(response))

  // Résumer, the questions and Résumé du jour are the adults': a young profile has its own explanations.
  const adultsOnly = (response: express.Response) => {
    if (kindOf(response) === 'adult') return true
    response.status(403).json({ error: 'young' })
    return false
  }

  return { youthLockOf, youthFilterOf, filterOf, languageOf, adultsOnly }
}

export type ReaderContext = ReturnType<typeof readerContext>
