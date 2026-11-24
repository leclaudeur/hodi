import type { Database } from '../db/database.ts'
import type { ForgetRecord } from '../db/forget-log.ts'
import type { InstallStore } from '../db/install-store.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import type { MailSettingsStore } from '../db/mail-settings-store.ts'
import type { PluginStore } from '../db/plugin-store.ts'
import { AccountLoginStore } from '../db/account-login-store.ts'
import { type ServerSettingsStore, publicServerSettings } from '../db/server-settings-store.ts'
import { DEFAULT_ACCOUNT_ID } from '../db/server-row.ts'
import { smtpSend } from '../mail/mailer.ts'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import type { FollowedAlerts } from '../news/followed-alerts.ts'
import type { NewsService } from '../news/news-service.ts'
import { pluginArticles } from '../plugins/articles.ts'
import { type AccountHooks, pluginAccounts } from '../plugins/accounts.ts'
import { PluginAccountStore } from '../db/plugin-account-store.ts'
import { pluginMailer } from '../plugins/mail.ts'
import { pluginNotifier } from '../plugins/notify.ts'
import { pluginServerNotifier } from '../plugins/server-notify.ts'
import type { ServerNotifier } from '../notices/server-notifier.ts'
import { pluginAi } from '../plugins/ai.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'

// The installed plugins, loaded with what each may reach of Hodi (start.ts).

interface PluginWiring {
  db: Database
  dir: string
  dataDir: string
  store: PluginStore
  news: NewsService
  accounts: UserAccountStore
  install: InstallStore
  profiles: ProfileStore
  alerts: FollowedAlerts
  serverNotices: ServerNotifier
  accountHooks: AccountHooks
  throttle: LoginThrottle
  mailSettings: MailSettingsStore
  serverSettings: ServerSettingsStore
}

// The plugins hear again of the deletions done again: their own data went back to the copy too.
export const replayToPlugins = (plugins: PluginRegistry, forgottenAgain: ForgetRecord[]) => {
  for (const entry of forgottenAgain) {
    if (entry.kind === 'profile') plugins.profileDeleted(entry.id, entry.householdId)
    if (entry.kind === 'account') plugins.accountDeleted(entry.id)
    if (entry.kind === 'household' || entry.kind === 'householdReset') plugins.householdRemoved(entry.id)
    if (entry.kind === 'householdReset') {
      for (const { id } of entry.accounts) plugins.accountDeleted(id)
      for (const { id } of entry.profiles) plugins.profileDeleted(id, entry.id)
    }
  }
}

export const startPlugins = async (wiring: PluginWiring) => {
  const { db, news, accounts, install, profiles, store } = wiring
  // A click on a signed plugin's AiButton: one question to the household's AI, in its 'plugin' caps.
  const pluginAiCalls = pluginAi({
    isOff: (_householdId, pluginId) => store.aiOff().has(pluginId),
    left: (_householdId, profileId) => news.pluginAiLeft(profileId),
    ask: (_householdId, pluginId, profileId, question) => news.askForPlugin(pluginId, profileId, question)
  })
  const plugins = await loadPlugins({
    dir: wiring.dir,
    dataDir: wiring.dataDir,
    store,
    ai: pluginAiCalls,
    scheduleTasks: true,
    articles: pluginArticles(news),
    accounts: pluginAccounts({
      accounts,
      logins: new AccountLoginStore(db),
      made: new PluginAccountStore(db),
      hooks: wiring.accountHooks,
      throttle: wiring.throttle
    }),
    // A plugin's notification, on the devices of a profile that want it (Réglages › Notifications › Plugins).
    notifier: pluginNotifier({
      householdOf: profileId => (profiles.find(profileId) ? DEFAULT_ACCOUNT_ID : null),
      profilesOf: accountId => accounts.profilesOf(accountId),
      push: (profileId, payload) => wiring.alerts.notifyShare(profileId, payload, 'plugins')
    }),
    // What a plugin tells the server's admin of (Serveur › Notifications).
    serverNotifier: pluginServerNotifier({ notifier: wiring.serverNotices }),
    serverSettings: () => publicServerSettings(wiring.serverSettings),
    // A plugin's e-mail ends in the server's language.
    mail: pluginMailer({
      store: wiring.mailSettings,
      send: smtpSend,
      home: () => wiring.serverSettings.publicHome(),
      languageOf: () => install.get().language
    })
  })
  return { plugins, pluginAiCalls }
}
