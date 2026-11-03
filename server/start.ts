import { randomInt } from 'node:crypto'
import path from 'node:path'
import webpush, { type PushSubscription } from 'web-push'
import { createApp } from './app.ts'
import type { Config } from './config.ts'
import { openDatabase } from './db/database.ts'
import { diskUsage, startMaintenance } from './db/maintenance.ts'
import { HouseholdStore } from './db/household-store.ts'
import { NewsStore } from './db/news-store.ts'
import { ProfileStore } from './db/profile-store.ts'
import { SourceStore, createPauseCheck } from './db/source-store.ts'
import { UserStore } from './db/user-store.ts'
import { GameStore } from './db/game-store.ts'
import { ImageStore } from './db/image-store.ts'
import { YouthStore } from './db/youth-store.ts'
import { loadRules } from './game/rules.ts'
import { loadCatalog } from './news/catalog.ts'
import { ArticleImages } from './news/article-images.ts'
import { type FetchBytes, type FetchText, createFetchBytes, createFetchText } from './news/fetch-text.ts'
import { FollowedAlerts } from './news/followed-alerts.ts'
import { MAX_TOPIC_LIMIT, NewsService } from './news/news-service.ts'
import { type FetchVideoDuration, createFetchVideoDuration } from './news/video-durations.ts'
import { SourceIcons } from './news/source-icons.ts'
import { type IsPublicUrl, createSourceFinder, isPublicUrl } from './news/source-finder.ts'
import { aiProvider } from './news/ai-providers.ts'
import { isLanguage } from '../shared/i18n.ts'

// Everything Hodi reaches outside the server: the sites it reads and the push services. index.ts gives the real ones;
// the end-to-end tests give pages of their own (e2e/server.ts).
export interface Outside {
  fetchText: FetchText
  // Looking at a link someone pastes to add a source: a shorter wait.
  findFetchText: FetchText
  // Whether a pasted link may be fetched at all: a public https address.
  isPublicLink: IsPublicUrl
  fetchBytes: FetchBytes
  // Article pictures, made smaller: a longer wait.
  fetchPictures: FetchBytes
  fetchVideoDuration: FetchVideoDuration
  sendPush: (target: PushSubscription, payload: unknown, vapid: Config['vapid']) => Promise<void>
}

export const realOutside = (): Outside => ({
  fetchText: createFetchText(),
  findFetchText: createFetchText({ timeoutMs: 8000 }),
  isPublicLink: isPublicUrl,
  fetchBytes: createFetchBytes(),
  fetchPictures: createFetchBytes({ timeoutMs: 10_000 }),
  fetchVideoDuration: createFetchVideoDuration(),
  sendPush: async (target, payload, vapid) => {
    await webpush.sendNotification(target, JSON.stringify(payload), {
      vapidDetails: vapid,
      // An alert older than a day is no longer news.
      TTL: 24 * 60 * 60,
      urgency: 'normal'
    })
  }
})

// Opens the database, starts the background work and serves the app.
export const startHodi = (config: Config, outside: Outside) => {
  const db = openDatabase(config.databaseFile)
  const store = new NewsStore(db)
  const profiles = new ProfileStore(db)
  // Each profile's state; the first one's also prunes them all and keeps the devices' push subscriptions.
  const users = new UserStore(db)
  const usersOf = (profileId: number) => new UserStore(db, profileId)
  // Article pictures made smaller, in the data folder beside the database.
  const images = new ArticleImages({
    store: new ImageStore(db),
    fetchBytes: outside.fetchPictures,
    dir: path.join(path.dirname(config.databaseFile), 'images')
  })
  startMaintenance({ db, stores: [store, users, images], backupDir: config.backupDir })
  const household = new HouseholdStore(db)
  // The young profiles' days run in the household's time zone.
  const youth = new YouthStore(db, () => household.get().timeZone ?? config.timeZone)
  // The database's catalogue, filled once from sources.yml's base sources in the household's language (at setup on a
  // new install), with the sources profiles added.
  const sources = new SourceStore(db)
  const file = loadCatalog(config.sourcesFile)
  const catalog = sources.load(file, Date.now(), household.isSetUp() ? household.get().language : null)
  const { fetchText } = outside
  const news = new NewsService(catalog, {
    fetchText,
    fetchVideoDuration: outside.fetchVideoDuration,
    // A source every profile turned off is not fetched.
    isPaused: createPauseCheck({
      hiddenByProfile: () => profiles.list().map(profile => usersOf(profile.id).hiddenSources()),
      now: Date.now
    }),
    profiles: () => profiles.list().map(profile => ({ id: profile.id, admin: profile.role === 'admin' })),
    // The AI writes in the profile's language, else the household's.
    languageOf: profileId => {
      const own = usersOf(profileId).preferences()?.language
      return isLanguage(own) ? own : household.get().language
    },
    householdLanguage: () => household.get().language,
    store
  })
  // The household's time zone and AI (none until a key is given), again whenever the admin changes them.
  const applyHousehold = () => {
    const current = household.get()
    const timeZone = current.timeZone ?? config.timeZone
    news.setTimeZone(timeZone)
    const provider = current.ai ? aiProvider(current.ai.provider) : null
    news.setAi(
      current.ai && provider
        ? provider.tools({
            key: current.ai.key,
            model: current.ai.model,
            region: { timeZone, country: current.country }
          })
        : null
    )
  }
  applyHousehold()
  news.setImagePreviews(itemId => images.preview(itemId))
  news.startBackgroundChecks()
  images.start()
  const icons = new SourceIcons(catalog, { fetchText, fetchBytes: outside.fetchBytes, store })
  // Notifications for followed subjects.
  const alerts = new FollowedAlerts({
    listItems: async () => {
      const topics = await Promise.all(
        news.catalog.topics.map(topic => news.getTopic(topic.id, MAX_TOPIC_LIMIT, { background: true }))
      )
      return topics.flatMap(topic => topic?.items ?? [])
    },
    // A young profile's parents decide when it is told anything.
    mayNotify: (profileId, now) => {
      const profile = profiles.get(profileId)
      return !profile || profile.kind === 'adult' || youth.mayNotify(profileId, now)
    },
    subscriptions: {
      list: () => users.listPushSubscriptions(),
      save: settings => users.savePushSubscription(settings, Date.now()),
      remove: endpoint => users.removePushSubscription(endpoint)
    },
    send: (target, payload) => outside.sendPush(target, payload, config.vapid)
  })
  alerts.start()

  // The household game's rules, next to sources.yml; points follow the household's days.
  const game = new GameStore(
    db,
    loadRules(path.resolve('gamification.yml')),
    () => household.get().timeZone ?? config.timeZone
  )

  const storage = {
    usage: () => ({ ...diskUsage(config.databaseFile, config.backupDir), ...store.counts() }),
    clearTexts: () => store.clearTexts()
  }

  // A new install waits for its first-run screens. A device away from the server's network (a server on the
  // internet) is asked for this code, which only whoever can read the server's log knows.
  const setupCode = String(randomInt(0, 1_000_000)).padStart(6, '0')
  if (!household.isSetUp()) {
    console.log(`Hodi is not set up yet: open it in a browser. Setup code, if asked: ${setupCode}`)
  }

  const server = createApp(config, {
    news,
    alerts,
    profiles,
    users: usersOf,
    icons,
    images,
    storage,
    game,
    youth,
    household,
    setupCode,
    onHouseholdChange: applyHousehold,
    sources: {
      store: sources,
      find: createSourceFinder({ fetchText: outside.findFetchText, isPublic: outside.isPublicLink }),
      file
    }
  }).listen(config.port, config.host, () => {
    console.log(`hodi listening on http://${config.host}:${config.port}`)
  })

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down`)
    server.close(() => {
      db.close()
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
