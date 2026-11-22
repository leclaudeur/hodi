import type express from 'express'
import { aiUsageRoutes } from '../http/ai-usage-routes.ts'
import { articleRoutes } from '../http/article-routes.ts'
import { gameRoutes, readFactsOf } from '../http/game-routes.ts'
import { newsRoutes } from '../http/news-routes.ts'
import { profileIdOf, requireAdmin } from '../http/profile-routes.ts'
import { pushRoutes } from '../http/push-routes.ts'
import { readingRoutes } from '../http/reading-routes.ts'
import { shareRoutes } from '../http/share-routes.ts'
import { sourceReportRoutes } from '../http/source-report-routes.ts'
import { sourceRoutes } from '../http/source-routes.ts'
import { sourceViewRoutes } from '../http/source-view-routes.ts'
import { userRoutes } from '../http/user-routes.ts'
import { mySourcesRoutes } from '../http/my-sources-routes.ts'
import { allSources } from '../news/catalog.ts'
import { accountAsking } from '../http/proof.ts'
import { SOURCE_REPORT, sourceReportKey, sourceReportNotice } from '../notices/source-report.ts'
import { SOURCE_REVIEW, sourceReviewKey, sourceReviewNotice } from '../notices/source-review.ts'
import { withPluginFeeds } from '../plugins/feeds.ts'
import type { Wiring } from './wiring.ts'

// Each profile's own state: reading, sharing, the game and its preferences.
const mountProfileState = (api: express.Router, { options, youthSources, session }: Wiring) => {
  const { users, news, profiles, game, alerts, now } = options
  if (!users) return
  api.use(readingRoutes({ users, news, now }))
  const accounts = options.accounts
  const signedInHere = (request: express.Request) => session.sessionsOf(request).map(signedIn => signedIn.account.id)
  api.use(shareRoutes({ users, profiles, accounts, signedInHere, news, game, alerts, now }))
  if (game) api.use(gameRoutes({ game, news, profiles, now }))
  const readFacts = readFactsOf(news)
  const lock = (response: express.Response) => {
    const profile = profiles?.get(profileIdOf(response))
    return profile && youthSources ? youthSources.lock(profile) : null
  }
  api.use(
    '/me/sources',
    mySourcesRoutes({
      users: response => users(profileIdOf(response)),
      // Out of the catalogue (À traiter, refused): not someone else's to add by id.
      listed: id =>
        !options.sources?.reviews?.unlisted().has(id) && news.getSourceStatuses().some(source => source.id === id),
      lock,
      now
    })
  )
  api.use(
    '/me',
    userRoutes({
      users: response => users(profileIdOf(response)),
      now,
      onRead: (response, ids, readAt) => game?.recordReads(profileIdOf(response), ids, now(), readAt, readFacts),
      lock
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

// While the server validates sources, a new one waits in À traiter: only its adder reads it until the admin decides.
const askReview = ({ options }: Wiring, sourceId: string) => {
  const reviews = options.sources?.reviews
  const source = options.news.getSourceStatuses().find(candidate => candidate.id === sourceId)
  if (!reviews || !source) return
  reviews.ask(sourceId, options.now())
  options.serverInbox?.notifier
    .tell(SOURCE_REVIEW, language => sourceReviewNotice(source, language), { important: sourceReviewKey(sourceId) })
    .catch((error: unknown) => console.error(`Source review not told: ${String(error)}`))
}

// « Signaler »: the first report on a source since the admin's last decision waits in À traiter.
const mountReports = (api: express.Router, { options }: Wiring) => {
  const { sources, news, accounts, serverInbox, now } = options
  const reports = sources?.reports
  if (!reports || !accounts) return
  api.use(
    '/sources',
    sourceReportRoutes({
      reports,
      news,
      accountOf: response => accountAsking(response, accounts)?.id ?? null,
      onFirst: source =>
        serverInbox?.notifier
          .tell(SOURCE_REPORT, language => sourceReportNotice(source, language), {
            important: sourceReportKey(source.id)
          })
          .catch((error: unknown) => console.error(`Source report not told: ${String(error)}`)),
      now
    })
  )
}

// "Ajouter une source".
const mountSources = (api: express.Router, wiring: Wiring) => {
  const { options } = wiring
  const { sources, news, plugins, serverSettings, users, profiles, now } = options
  if (!sources) return
  const reviews = sources.reviews
  // Everyone else's list hears of one more in the catalogue.
  const toOthers = (profileId: number | null) =>
    profiles
      ?.list()
      .filter(profile => profile.id !== profileId)
      .forEach(profile => users?.(profile.id).sources.catalogueChanged(now()))
  api.use(
    '/sources',
    sourceRoutes({
      news,
      sources: sources.store,
      find: sources.find,
      // A plugin's feeds are offered with sources.yml's.
      proposals: () => sources.store.proposals(withPluginFeeds(sources.file, plugins)),
      maxSources: () => serverSettings?.maxSources() ?? null,
      // In its adder's « Mes sources » only: the others add it from the catalogue if they want it.
      onAdded: (sourceId, profileId) => {
        users?.(profileId).sources.add([sourceId], now())
        if (reviews?.validating()) askReview(wiring, sourceId)
        else toOthers(profileId)
      },
      ...(reviews
        ? {
            unlisted: () => reviews.unlisted(),
            onAddedAgain: (sourceId: string, profileId: number) => {
              users?.(profileId).sources.add([sourceId], now())
              if (reviews.mayAskAgain(sourceId, now())) askReview(wiring, sourceId)
            }
          }
        : {}),
      now
    })
  )
}

// The reading itself: feeds, articles, sources, alerts and the AI's usage.
export const mountReading = (api: express.Router, wiring: Wiring) => {
  const { news, users, youth, icons, images, alerts, plugins, sources, now } = wiring.options
  mountProfileState(api, wiring)
  api.use(
    sourceViewRoutes({
      ...{ news, users, youth, icons, now },
      readers: sources && (() => sources.store.readers()),
      unlisted: sources?.reviews && (() => sources.reviews?.unlisted() ?? new Set<string>()),
      official: sources && (() => new Set(allSources(sources.file).map(source => source.id)))
    })
  )
  api.use(newsRoutes({ news, users, reader: wiring.reader, now }))
  api.use(pushRoutes({ alerts, publicKey: wiring.config.vapid.publicKey }))
  api.use(aiUsageRoutes({ news, plugins }))
  mountStorage(api, wiring)
  mountReports(api, wiring)
  mountSources(api, wiring)
  api.use(articleRoutes({ news, users, images, reader: wiring.reader }))
}
