import path from 'node:path'
import { createApp } from './app.ts'
import type { Config } from './config.ts'
import type { Database } from './db/database.ts'
import { type PluginBackup, diskUsage } from './db/maintenance.ts'
import { drawCode } from './db/sign-in-code-store.ts'
import { smtpSend } from './mail/mailer.ts'
import { PluginInstaller } from './plugins/installer.ts'
import { pluginArticle } from './plugins/articles.ts'
import { householdHooks } from './plugins/households.ts'
import type { PluginRegistry } from './plugins/registry.ts'
import type { PluginAi } from './plugins/ai.ts'
import { LoginThrottle } from './auth/login-throttle.ts'
import type { FollowedAlerts } from './news/followed-alerts.ts'
import type { NewsService } from './news/news-service.ts'
import type { SourceIcons } from './news/source-icons.ts'
import { createSourceFinder } from './news/source-finder.ts'
import type { Outside } from './start/outside.ts'
import { PluginCatalog } from './plugins/catalog.ts'
import { openRestoredDatabase } from './start/restore.ts'
import { type Stores, openStores } from './start/stores.ts'
import { createIcons, createNews } from './start/news.ts'
import { createAlerts } from './start/alerts.ts'
import { replayToPlugins, startPlugins } from './start/plugins.ts'

export { type Outside, realOutside } from './start/outside.ts'

interface Running {
  config: Config
  db: Database
  outside: Outside
  stores: Stores
  news: NewsService
  applyHousehold: () => void
  icons: SourceIcons
  alerts: FollowedAlerts
  plugins: PluginRegistry
  pluginAi: PluginAi
  pluginsDir: string
  pluginBackup: PluginBackup
  pendingRestore: string
  hooks: ReturnType<typeof householdHooks>
  throttle: LoginThrottle
  restart: (reason: string) => void
}

// A new install waits for its first-run screens. A device away from the server's network (a server on the
// internet) is asked for this code, which only whoever can read the server's log knows.
const drawSetupCode = (stores: Stores) => {
  const setupCode = drawCode()
  if (!stores.household.isSetUp()) {
    console.log(`Hodi is not set up yet: open it in a browser. Setup code, if asked: ${setupCode}`)
  }
  return setupCode
}

const serve = ({ config, outside, stores, news, plugins, restart, ...running }: Running) => {
  const { store } = stores
  return createApp(config, {
    householdHooks: running.hooks,
    news,
    accounts: stores.accounts,
    devices: stores.devices,
    profileDevices: stores.profileDevices,
    accountData: stores.accountData,
    codes: stores.codes,
    twoFactor: stores.twoFactor,
    alerts: running.alerts,
    profiles: stores.profiles,
    users: stores.usersOf,
    icons: running.icons,
    images: stores.images,
    storage: {
      usage: () => ({ ...diskUsage(config.databaseFile, config.backupDir), ...store.counts() }),
      clearTexts: () => store.clearTexts()
    },
    game: stores.game,
    serverStats: stores.serverStats,
    serverPeople: stores.serverPeople,
    serverSettings: stores.serverSettings,
    serverBackups: {
      db: running.db,
      dir: config.backupDir,
      plugins: running.pluginBackup,
      // Stops cleanly; Docker starts Hodi again (restart: unless-stopped) on the copy.
      restore: { pending: running.pendingRestore, restart: () => restart('a backup restored') }
    },
    throttle: running.throttle,
    serverMail: { store: stores.mailSettings, send: smtpSend },
    passwordResets: stores.passwordResets,
    youth: stores.youth,
    plugins,
    pluginAi: running.pluginAi,
    pluginInstaller: {
      installer: new PluginInstaller({
        dir: running.pluginsDir,
        installedVersion: id => plugins.get(id)?.manifest?.version ?? null
      }),
      // Stops cleanly; Docker starts Hodi again (restart: unless-stopped) and it reads the plugins anew.
      restart: () => restart('a plugin change'),
      catalog: new PluginCatalog({ fetchText: outside.fetchText, fetchBytes: outside.fetchPackages })
    },
    household: stores.household,
    setupCode: drawSetupCode(stores),
    onHouseholdChange: running.applyHousehold,
    sources: {
      store: stores.sources,
      find: createSourceFinder({ fetchText: outside.findFetchText, isPublic: outside.isPublicLink }),
      file: stores.file
    }
  }).listen(config.port, config.host, () => {
    console.log(`hodi listening on http://${config.host}:${config.port}`)
  })
}

// Opens the database, loads the plugins, starts the background work and serves the app.
export const startHodi = async (config: Config, outside: Outside) => {
  // « Restaurer » set a copy aside before the restart: it takes the database's place before it opens.
  const { db, forgetLog, forgottenAgain, pendingRestore, pluginDataDir } = openRestoredDatabase(config)
  // Each copy holds the plugins' data too. Until the plugins load, their databases are copied as they are: nothing
  // writes them yet.
  let loadedPlugins: PluginRegistry | null = null
  const pluginBackup: PluginBackup = { dataDir: pluginDataDir, snapshots: () => loadedPlugins }
  const stores = openStores(config, { db, outside, forgetLog, pluginBackup })
  const { news, applyHousehold } = createNews({
    config,
    outside,
    ...stores,
    // A plugin's feed, once the plugins are loaded below.
    plugins: () => loadedPlugins
  })
  applyHousehold()
  news.setImagePreviews(itemId => stores.images.preview(itemId))
  news.startBackgroundChecks()
  stores.images.start()
  const icons = createIcons({ outside, ...stores })
  // Notifications for followed subjects.
  const alerts = createAlerts({ config, outside, news, ...stores })
  alerts.start()

  // The installed plugins, from the data folder: read once, since installing or removing one restarts Hodi.
  const pluginsDir = path.join(path.dirname(config.databaseFile), 'plugins')
  // Failed sign-ins, and a plugin's failed password checks, count together for each address.
  const throttle = new LoginThrottle()
  // What a plugin's new household needs from the app (its base sources, its profiles' set-up), filled in by createApp.
  const hooks = householdHooks()
  const { plugins, pluginAiCalls } = await startPlugins({
    ...stores,
    db,
    dir: pluginsDir,
    dataDir: pluginDataDir,
    store: stores.pluginStore,
    news,
    alerts,
    hooks,
    throttle
  })
  loadedPlugins = plugins
  replayToPlugins(plugins, forgottenAgain)
  news.setArticleListener(result => {
    const article = pluginArticle(result)
    if (article) plugins.tellArticle(article)
  })

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down`)
    server.close(() => {
      db.close()
      process.exit(0)
    })
  }
  const server = serve({
    config,
    outside,
    db,
    stores,
    news,
    applyHousehold,
    icons,
    alerts,
    plugins,
    pluginAi: pluginAiCalls,
    pluginsDir,
    pluginBackup,
    pendingRestore,
    hooks,
    throttle,
    restart: shutdown
  })

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
