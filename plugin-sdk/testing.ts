import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashPassword } from '../server/auth/password.ts'
import { inHousehold } from '../server/db/household-scope.ts'
import type { ProfileKind } from '../server/db/profile-store.ts'
import type { MailMessage } from '../server/mail/mailer.ts'
import type { HttpAnswer } from '../server/news/fetch-text.ts'
import type { PluginQuestion } from '../server/news/summarizer.ts'
import type { AlertPayload } from '../server/news/followed-alerts.ts'
import type { PluginArticle } from '../server/plugins/articles.ts'
import type { PluginRegistry } from '../server/plugins/registry.ts'
import { callContext } from '../server/plugins/call-context.ts'
import type { PluginSandbox } from '../server/plugins/sandbox/sandbox.ts'
import { buildPlugin } from './build.ts'
import { type Recorded, startSmallHodi } from './testing-host.ts'
import { sendTo, serveKit } from './testing-routes.ts'

// @hodi-app/plugin-sdk/testing: a plugin's server part run as Hodi runs it, for its own tests (node:test, Vitest…).
// The plugin is built from its folder, signed with a key made for the test, and loaded in Hodi's own sandbox, with
// Hodi's own routes in front of it. Around it, a small Hodi in memory: one household, the people a test adds, and
// fakes for what leaves the server (sites, e-mails, notifications, the AI), which the test sets and reads.

// A site's answer for ctx.fetchText and ctx.http: its text, or the whole answer.
export type TestSite = string | Partial<HttpAnswer> | ((request: TestSiteRequest) => string | Partial<HttpAnswer>)

export interface TestSiteRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

export interface TestPluginOptions {
  // Its settings, as the admin would set them in Hodi (the rest keep their default).
  settings?: Record<string, boolean | number | string>
  // The answers of the sites in permissions.network, by address. Any other address fails as a closed site would.
  sites?: Record<string, TestSite>
  // The articles Hodi listed, for ctx.articles: by id.
  articles?: Record<string, PluginArticle & { html?: string }>
  // The household's AI: the answer to each question of ctx.ai (none: the household has no AI).
  ai?: (question: PluginQuestion) => string
  // Serveur › E-mail set up (true, the default) or not, for ctx.mail.available().
  mail?: boolean
  // The household's name and language.
  household?: { name?: string; language?: 'fr' | 'en' }
  // Built unsigned: Hodi then refuses accounts, households, signIn, mail, notify and ai, as it would.
  unsigned?: boolean
}

// Someone of the test household.
export interface TestPerson {
  profileId: number
  // Their account; null for a teen's or a child's profile, which has none.
  accountId: number | null
  email: string | null
  kind: ProfileKind
  admin: boolean
}

export interface TestAnswer {
  status: number
  // JSON when the answer is JSON, else its text.
  body: unknown
  headers: Headers
}

export interface TestCall {
  // Who calls: a person of the household (the household's admin when absent).
  as?: TestPerson
  query?: Record<string, string>
  body?: unknown
  headers?: Record<string, string>
  // For a route marked proof: true, the person typed their password (and code) in Hodi's dialog; without it, such a
  // route answers 403 proof_required.
  proof?: boolean
}

export interface TestPlugin {
  id: string
  // The household every call is for.
  householdId: number
  // The household's admin, an adult with an account, made first.
  admin: TestPerson
  // Someone else in the household. An adult gets an account (e-mail and password), a teen or a child does not.
  addPerson: (person: { name: string; kind?: ProfileKind; email?: string; password?: string }) => Promise<TestPerson>
  // An account in no household, as one a sign-up page would make.
  addAccount: (account: { email: string; password?: string }) => Promise<number>
  // Its routes, as Hodi serves them: route('GET /notes'), publicRoute('POST /signup', { body }), serverRoute(…).
  route: (route: string, call?: TestCall) => Promise<TestAnswer>
  publicRoute: (route: string, call?: Omit<TestCall, 'as'>) => Promise<TestAnswer>
  serverRoute: (route: string, call?: Omit<TestCall, 'as'>) => Promise<TestAnswer>
  // A click on its AiButton, by an adult of the household.
  click: (action: string, input?: unknown, as?: TestPerson) => Promise<TestAnswer>
  // What Hodi would start by itself.
  runTask: (name: string) => Promise<unknown>
  readFeed: (key: string) => Promise<unknown>
  tellArticle: (article: PluginArticle) => Promise<unknown>
  checkSignIn: (who: { accountId: number; householdId: number | null }) => Promise<unknown>
  profileDeleted: (profileId: number) => Promise<void>
  accountDeleted: (accountId: number) => Promise<void>
  householdRemoved: (householdId: number) => Promise<void>
  exportData: (person: TestPerson) => Promise<unknown>
  // What left the server, in order: e-mails, notifications, the AI's questions, the accounts a route signed in.
  mails: MailMessage[]
  notifications: { profileId: number; payload: AlertPayload }[]
  questions: PluginQuestion[]
  signedIn: number[]
  // Its log lines, and Hodi's lines about it (a refused permission, a hook that failed).
  log: string[]
  // Hodi's own registry, for what the helpers above do not cover.
  registry: PluginRegistry
  stop: () => Promise<void>
}

const DEFAULT_PASSWORD = 'a test password, long enough'

// The plugin built from its folder into a fresh folder, signed unless the test asks otherwise.
const buildForTest = async (folder: string, options: TestPluginOptions) => {
  const work = mkdtempSync(path.join(tmpdir(), 'hodi-plugin-test-'))
  const dir = path.join(work, 'plugins')
  // A key made for this test, which the small Hodi trusts: the plugin is « Vérifié », as a release would be.
  const keys = generateKeyPairSync('ed25519')
  const built = await buildPlugin(path.resolve(folder), {
    out: dir,
    ...(options.unsigned ? {} : { key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() })
  })
  rmSync(built.file, { force: true })
  return { work, dir, id: built.id, trustedKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
}

type SmallHodi = Awaited<ReturnType<typeof startSmallHodi>>

// People: the household's admin first, then whoever the test adds.
const peopleOf = ({ db, accounts, profiles, householdId }: SmallHodi, now: () => number) => {
  const addAccount = async ({ email, password = DEFAULT_PASSWORD }: { email: string; password?: string }) => {
    const account = accounts.create(email, await hashPassword(password), now())
    if (!account) throw new Error(`${email} already has an account`)
    return account.id
  }
  const addPerson: TestPlugin['addPerson'] = async ({ name, kind = 'adult', email, password }) => {
    const profile = inHousehold(householdId, () => profiles.create(name, 'world', now(), { kind }))
    if (!profile) throw new Error('The household is full')
    let accountId: number | null = null
    const address = kind === 'adult' ? (email ?? `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@example.test`) : null
    if (address) {
      accountId = await addAccount({ email: address, ...(password ? { password } : {}) })
      accounts.linkProfile(accountId, profile.id)
    }
    return { profileId: profile.id, accountId, email: address, kind, admin: profile.role === 'admin' }
  }
  const addAdmin = async (): Promise<TestPerson> => {
    const [first] = profiles.list()
    const adminAccount = await addAccount({ email: 'admin@example.test' })
    accounts.linkProfile(adminAccount, first!.id)
    db.prepare("UPDATE profiles SET name = 'Admin', role = 'admin' WHERE id = ?").run(first!.id)
    return { profileId: first!.id, accountId: adminAccount, email: 'admin@example.test', kind: 'adult', admin: true }
  }
  return { addAccount, addPerson, addAdmin }
}

// What Hodi would start by itself, and what it tells the plugin of people's deletions.
const hooksOf = (hodi: SmallHodi, id: string, sandbox: PluginSandbox) => {
  const { registry, householdId } = hodi
  const hook = (name: string, payload: unknown, forHousehold: number | null = householdId) =>
    sandbox.call('hook', name, payload, callContext(forHousehold))
  const erased = async (tell: () => void) => {
    tell()
    await registry.runErasures()
  }
  return {
    runTask: (name: string) => sandbox.call('task', name, null, callContext(null)),
    readFeed: (key: string) => registry.readFeed(id, key),
    tellArticle: (article: PluginArticle) => hook('onArticle', article),
    checkSignIn: (who: { accountId: number; householdId: number | null }) => hook('checkSignIn', who, who.householdId),
    profileDeleted: (profileId: number) => erased(() => registry.profileDeleted(profileId, householdId)),
    accountDeleted: (accountId: number) => erased(() => registry.accountDeleted(accountId)),
    householdRemoved: (removed: number) => erased(() => registry.householdRemoved(removed)),
    exportData: (person: TestPerson) =>
      hook('exportData', { accountId: person.accountId, profileId: person.profileId, householdId })
  }
}

export const testPlugin = async (folder = '.', options: TestPluginOptions = {}): Promise<TestPlugin> => {
  const { work, dir, id, trustedKey } = await buildForTest(folder, options)
  const now = Date.now
  const recorded: Recorded = { mails: [], notifications: [], questions: [], signedIn: [], log: [] }
  const hodi = await startSmallHodi({ dir, dataDir: path.join(work, 'data'), trustedKey }, options, recorded, now)
  const { db, registry, store, householdId } = hodi
  const plugin = registry.get(id)
  if (!plugin?.sandbox) {
    await registry.stop()
    throw new Error(`${id} did not start: ${plugin?.error ?? 'no server part'}`)
  }
  if (options.settings) store.updateSettings(id, options.settings)

  const { addAccount, addPerson, addAdmin } = peopleOf(hodi, now)
  const admin = await addAdmin()
  const { server, base } = await serveKit({ ...hodi, signedIn: recorded.signedIn })
  const send = sendTo(base, id)
  const asHeaders = (person: TestPerson = admin) => ({ 'x-test-profile': String(person.profileId) })

  return {
    id,
    householdId,
    admin,
    addPerson,
    addAccount,
    route: (route, call = {}) => send('/plugins', route, call, asHeaders(call.as)),
    publicRoute: (route, call = {}) => send('/public/plugins', route, call, {}),
    serverRoute: (route, call = {}) => send('/server/plugins', route, call, { 'x-test-server-admin': '1' }),
    click: (action, input = null, as = admin) =>
      send('/plugins', `POST /ai/${action}`, { body: { input } }, asHeaders(as)),
    ...hooksOf(hodi, id, plugin.sandbox),
    ...recorded,
    registry,
    stop: async () => {
      await new Promise(resolve => server.close(resolve))
      await registry.stop()
      db.close()
      rmSync(work, { recursive: true, force: true })
    }
  }
}
