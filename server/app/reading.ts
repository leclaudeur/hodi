import type express from 'express'
import { aiUsageRoutes } from '../http/ai-usage-routes.ts'
import { articleRoutes } from '../http/article-routes.ts'
import { gameRoutes, readFactsOf } from '../http/game-routes.ts'
import { newsRoutes } from '../http/news-routes.ts'
import { profileIdOf, requireAdmin } from '../http/profile-routes.ts'
import { pushRoutes } from '../http/push-routes.ts'
import { readingRoutes } from '../http/reading-routes.ts'
import { shareRoutes } from '../http/share-routes.ts'
import { sourceRoutes } from '../http/source-routes.ts'
import { sourceViewRoutes } from '../http/source-view-routes.ts'
import { userRoutes } from '../http/user-routes.ts'
import { withPluginFeeds } from '../plugins/feeds.ts'
import type { Wiring } from './wiring.ts'

// Each profile's own state: reading, sharing, the game and its preferences.
const mountProfileState = (api: express.Router, { options, youthSources }: Wiring) => {
  const { users, news, profiles, game, alerts, now } = options
  if (!users) return
  api.use(readingRoutes({ users, news, now }))
  api.use(shareRoutes({ users, profiles, news, game, alerts, now }))
  if (game) api.use(gameRoutes({ game, news, profiles, now }))
  const readFacts = readFactsOf(news)
  api.use(
    '/me',
    userRoutes({
      users: response => users(profileIdOf(response)),
      now,
      onRead: (response, ids, readAt) => game?.recordReads(profileIdOf(response), ids, now(), readAt, readFacts),
      lock: response => {
        const profile = profiles?.get(profileIdOf(response))
        return profile && youthSources ? youthSources.lock(profile) : null
      }
    })
  )
}

// What the database takes on disk, and emptying its reader texts, in Réglages.
const mountStorage = (api: express.Router, { options }: Wiring) => {
  const { storage } = options
  if (!storage) return
  api.get('/storage', requireAdmin, (_request, response) => {
    response.json(storage.usage())
  })
  api.delete('/storage/texts', requireAdmin, (_request, response) => {
    storage.clearTexts()
    response.json(storage.usage())
  })
}

// "Ajouter une source".
const mountSources = (api: express.Router, { options, profileHooks }: Wiring) => {
  const { sources, news, plugins, serverSettings, profiles, now } = options
  if (!sources) return
  api.use(
    '/sources',
    sourceRoutes({
      news,
      sources: sources.store,
      find: sources.find,
      // A plugin's feeds are offered with sources.yml's.
      proposals: () => sources.store.proposals(withPluginFeeds(sources.file, plugins)),
      maxSources: () => serverSettings?.maxSources() ?? null,
      // The other profiles find it off: each one turns on what it wants to read.
      onAdded: (sourceId, profileId) =>
        profiles
          ?.list()
          .filter(profile => profile.id !== profileId)
          .forEach(profile => profileHooks.hideSources(profile.id, [sourceId])),
      now
    })
  )
}

// The reading itself: feeds, articles, sources, alerts and the AI's usage.
export const mountReading = (api: express.Router, wiring: Wiring) => {
  const { news, users, youth, icons, images, alerts, plugins, now } = wiring.options
  mountProfileState(api, wiring)
  api.use(sourceViewRoutes({ news, users, youth, icons, now }))
  api.use(newsRoutes({ news, users, reader: wiring.reader, now }))
  api.use(pushRoutes({ alerts, publicKey: wiring.config.vapid.publicKey }))
  api.use(aiUsageRoutes({ news, plugins }))
  mountStorage(api, wiring)
  mountSources(api, wiring)
  api.use(articleRoutes({ news, users, images, reader: wiring.reader }))
}
