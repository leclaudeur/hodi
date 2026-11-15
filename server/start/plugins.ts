import type { Database } from '../db/database.ts'
import type { ForgetRecord } from '../db/forget-log.ts'
import type { HouseholdStore } from '../db/household-store.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import type { UserAccountStore } from '../db/user-account-store.ts'
import type { SignInCodeStore } from '../db/sign-in-code-store.ts'
import type { MailSettingsStore } from '../db/mail-settings-store.ts'
import type { PluginStore } from '../db/plugin-store.ts'
import { AccountLoginStore } from '../db/account-login-store.ts'
import { PluginHouseholdStore } from '../db/plugin-household-store.ts'
import { type ServerSettingsStore, publicServerSettings } from '../db/server-settings-store.ts'
import { inHousehold } from '../db/household-scope.ts'
import { smtpSend } from '../mail/mailer.ts'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import type { FollowedAlerts } from '../news/followed-alerts.ts'
import type { NewsService } from '../news/news-service.ts'
import { pluginArticles } from '../plugins/articles.ts'
import { pluginAccounts } from '../plugins/accounts.ts'
import { type HouseholdHooks, pluginHouseholds } from '../plugins/households.ts'
import { pluginMailer } from '../plugins/mail.ts'
import { pluginNotifier } from '../plugins/notify.ts'
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
  codes: SignInCodeStore
  household: HouseholdStore
  profiles: ProfileStore
  alerts: FollowedAlerts
  hooks: HouseholdHooks
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
  const { db, news, accounts, household, profiles, store } = wiring
  // A click on a signed plugin's AiButton: one question to the household's AI, in its 'plugin' caps.
  const pluginAiCalls = pluginAi({
    isOff: (householdId, pluginId) => store.aiOff(householdId).has(pluginId),
    left: (householdId, profileId) => inHousehold(householdId, () => news.pluginAiLeft(profileId)),
    ask: (householdId, pluginId, profileId, question) =>
      inHousehold(householdId, () => news.askForPlugin(pluginId, profileId, question))
  })
  const plugins = await loadPlugins({
    dir: wiring.dir,
    dataDir: wiring.dataDir,
    store,
    ai: pluginAiCalls,
    scheduleTasks: true,
    articles: pluginArticles(news),
    accounts: pluginAccounts({ accounts, logins: new AccountLoginStore(db), throttle: wiring.throttle }),
    // A plugin's notification, on the devices of a profile that want it (Réglages › Notifications › Plugins).
    notifier: pluginNotifier({
      householdOf: profileId => profiles.householdOf(profileId),
      profilesOf: accountId => accounts.profilesOf(accountId),
      push: (profileId, payload) => wiring.alerts.notifyShare(profileId, payload, 'plugins')
    }),
    households: pluginHouseholds({
      store: new PluginHouseholdStore(db),
      accounts,
      codes: wiring.codes,
      hooks: wiring.hooks
    }),
    serverSettings: () => publicServerSettings(wiring.serverSettings),
    // A plugin's e-mail ends in the language of the recipient's household, when they have an account.
    mail: pluginMailer({
      store: wiring.mailSettings,
      send: smtpSend,
      languageOf: email => {
        const account = accounts.byEmail(email)
        const householdId = account ? accounts.householdOf(account.id) : null
        return householdId === null ? 'fr' : inHousehold(householdId, () => household.get().language)
      }
    })
  })
  return { plugins, pluginAiCalls }
}
