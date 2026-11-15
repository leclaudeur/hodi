import { LoginThrottle } from '../server/auth/login-throttle.ts'
import { AccountLoginStore } from '../server/db/account-login-store.ts'
import { openDatabase } from '../server/db/database.ts'
import { DEFAULT_ACCOUNT_ID } from '../server/db/household-scope.ts'
import { HouseholdStore } from '../server/db/household-store.ts'
import type { MailSettings } from '../server/db/mail-settings-store.ts'
import { PluginHouseholdStore } from '../server/db/plugin-household-store.ts'
import { PluginStore } from '../server/db/plugin-store.ts'
import { ProfileStore } from '../server/db/profile-store.ts'
import { SignInCodeStore } from '../server/db/sign-in-code-store.ts'
import { UserAccountStore } from '../server/db/user-account-store.ts'
import type { HttpAnswer } from '../server/news/fetch-text.ts'
import { pluginAccounts } from '../server/plugins/accounts.ts'
import { pluginAi } from '../server/plugins/ai.ts'
import type { PluginArticle } from '../server/plugins/articles.ts'
import { householdHooks, pluginHouseholds } from '../server/plugins/households.ts'
import { pluginMailer } from '../server/plugins/mail.ts'
import { pluginNotifier } from '../server/plugins/notify.ts'
import { type LoadPluginsOptions, loadPlugins } from '../server/plugins/registry.ts'
import type { TestPlugin, TestPluginOptions, TestSite, TestSiteRequest } from './testing.ts'

// The small Hodi in memory a plugin's tests run in (testing.ts): one household, and fakes for what leaves the server.

const MAIL: MailSettings = {
  host: 'smtp.example.test',
  port: 587,
  security: 'starttls',
  user: null,
  password: null,
  sender: 'hodi@example.test',
  appUrl: 'https://hodi.example.test',
  updatedAt: 0
}

const siteAnswer = (site: TestSite, request: TestSiteRequest): HttpAnswer => {
  const answer = typeof site === 'function' ? site(request) : site
  const full = typeof answer === 'string' ? { text: answer } : answer
  return { url: request.url, status: 200, contentType: 'text/html', text: '', ...full }
}

// What left the server, in order, for the test to read.
export type Recorded = Pick<TestPlugin, 'mails' | 'notifications' | 'questions' | 'signedIn' | 'log'>

// The sites and articles of the test: each address is checked against permissions.network by Hodi itself, then
// answered from the test's sites.
const fakeReach = (
  options: TestPluginOptions
): Pick<LoadPluginsOptions, 'fetchTextFor' | 'fetchHttpFor' | 'articles'> => {
  const sites = options.sites ?? {}
  const visit = async (request: TestSiteRequest) => {
    const site = sites[request.url]
    if (site === undefined) throw new Error(`No answer for ${request.url} in the test's sites`)
    return siteAnswer(site, request)
  }
  const articles = options.articles ?? {}
  return {
    fetchTextFor:
      isAllowed =>
      async (url, { headers = {} } = {}) => {
        if (!(await isAllowed(new URL(url)))) throw new Error(`Blocked address: ${url}`)
        const { text, url: at } = await visit({ url, method: 'GET', headers })
        return { url: at, text }
      },
    fetchHttpFor:
      isAllowed =>
      async (url, { method, headers = {}, body }) => {
        if (!(await isAllowed(new URL(url)))) throw new Error(`Blocked address: ${url}`)
        return visit({ url, method, headers, ...(body === undefined ? {} : { body }) })
      },
    articles: {
      get: async id => {
        const article = articles[id]
        if (!article) return null
        // Its page is for page(): the article itself is as the reader shows it.
        const rest: Partial<typeof article> = { ...article }
        delete rest.html
        return rest as PluginArticle
      },
      page: async id => {
        const article = articles[id]
        return article?.html === undefined ? null : { url: article.url, html: article.html }
      }
    }
  }
}

// The database and stores of a household set up for the test.
const openHousehold = (options: TestPluginOptions, now: () => number) => {
  const db = openDatabase(':memory:')
  const household = new HouseholdStore(db)
  household.setUp(
    {
      name: options.household?.name ?? 'Test',
      timeZone: 'UTC',
      country: null,
      language: options.household?.language ?? 'fr',
      ai: null
    },
    now()
  )
  const householdId = DEFAULT_ACCOUNT_ID
  return {
    db,
    householdId,
    accounts: new UserAccountStore(db),
    store: new PluginStore(db),
    profiles: new ProfileStore(db, householdId)
  }
}

export const startSmallHodi = async (
  { dir, dataDir, trustedKey }: { dir: string; dataDir: string; trustedKey: string },
  options: TestPluginOptions,
  recorded: Recorded,
  now: () => number
) => {
  const { db, householdId, accounts, store, profiles } = openHousehold(options, now)
  const { mails, notifications, questions, log } = recorded
  const answer = options.ai
  // One for the AiButton's route and ctx.ai, as in Hodi: the hourly count is theirs together.
  const ai = pluginAi({
    isOff: () => false,
    left: () => answer !== undefined,
    ask: async (_householdId, _pluginId, _profileId, question) => {
      if (!answer) return { status: 'unavailable' }
      questions.push(question)
      return { status: 'ok', text: answer(question) }
    }
  })

  const registry = await loadPlugins({
    dir,
    dataDir,
    store,
    trustedKeys: [trustedKey],
    isPublicUrl: async () => true,
    ...fakeReach(options),
    accounts: pluginAccounts({ accounts, logins: new AccountLoginStore(db), throttle: new LoginThrottle() }),
    households: pluginHouseholds({
      store: new PluginHouseholdStore(db),
      accounts,
      codes: new SignInCodeStore(db, Buffer.alloc(32, 7)),
      hooks: householdHooks()
    }),
    mail: pluginMailer({
      store: { get: () => (options.mail === false ? null : MAIL) },
      send: async (_settings, message) => {
        mails.push(message)
      },
      log: line => log.push(line)
    }),
    notifier: pluginNotifier({
      householdOf: profileId => (profiles.get(profileId) ? householdId : null),
      profilesOf: accountId => accounts.profilesOf(accountId),
      push: async (profileId, payload) => {
        notifications.push({ profileId, payload })
      },
      log: line => log.push(line)
    }),
    ai,
    serverSettings: () => ({ articleDays: 3, videoDays: 60, textDays: 7, backupCopies: 7, maxSources: null }),
    log: line => log.push(line)
  })
  return { db, householdId, accounts, store, profiles, ai, registry }
}
