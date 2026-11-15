import assert from 'node:assert/strict'
import { Secret, TOTP } from 'otpauth'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { AccountLoginStore } from '../db/account-login-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { TwoFactorStore } from '../db/two-factor-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { isPublicAddressUrl } from '../news/address-guard.ts'
import { NewsService } from '../news/news-service.ts'
import { OUTDATED_API } from '../plugins/manifest.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'
import { MAX_WAITING_CALLS, threadCostMb } from '../plugins/sandbox/sandbox.ts'
import { pluginMailer } from '../plugins/mail.ts'
import { pluginAccounts } from '../plugins/accounts.ts'
import { householdHooks, pluginHouseholds } from '../plugins/households.ts'
import { PluginHouseholdStore } from '../db/plugin-household-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { DEFAULT_MAX_FAILURES, LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import type { MailMessage } from '../mail/mailer.ts'
import { fakeFetch } from './helpers/news.ts'
import { TEST_TRUSTED_KEYS, signTestFolder } from './helpers/signing.ts'

// The hostile plugins of the security review (fixtures/hostile-plugins/H*/): each one is written to do harm, and each
// expected.json says what Hodi must answer instead. The structured checks run as written; the plain-text ones (setup,
// whileRunning, afterInCore…) are coded by hand below. The cases for points not built yet are marked todo.

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hostile-plugins')
// The plugins' time limit: the cases expect a refusal within 6 seconds.
const TIMEOUT_MS = 5_000
const ADMIN_PASSWORD = 'une phrase de passe assez longue'
const ADULT_PASSWORD = 'adult-password-1'

interface Expect {
  status?: number
  statusIn?: number[]
  withinMs?: number
  body?: unknown
  everyItem?: Record<string, unknown>
  headers?: Record<string, string>
  headersAbsent?: string[]
  cspContains?: string
  bodyKeysSubsetOf?: string[]
  bodyKeysNotContaining?: string[]
  contentTypeNotIn?: string[]
}

interface Case {
  case: string
  title: string
  // None for a case driven by hand (H49).
  requests?: {
    method: string
    path: string
    expect: Expect
    headers?: Record<string, string>
    // To the plugin's public routes, with no cookie, or with the admin's.
    anonymous?: boolean
    asCookieOf?: 'admin'
    body?: unknown
    rawBody?: string
    bodyBytes?: number
  }[]
  alwaysCheck?: string[]
}

// What still waits for a later pull request: these cases run once their feature exists.
const TODO: Record<string, string> = {}

const cases = readdirSync(FIXTURES)
  .filter(name => /^H\d+b?$/.test(name))
  .sort((a, b) => Number.parseInt(a.slice(1)) - Number.parseInt(b.slice(1)) || a.localeCompare(b))
  .map(name => ({
    folder: name,
    ...(JSON.parse(readFileSync(path.join(FIXTURES, name, 'expected.json'), 'utf8')) as Case)
  }))

// The body holds what the case expects; a plugin may add details (an error message) beside it.
const includes = (actual: unknown, expected: unknown, label: string) => {
  if (typeof expected !== 'object' || expected === null || Array.isArray(expected)) {
    assert.deepEqual(actual, expected, label)
    return
  }
  assert.ok(typeof actual === 'object' && actual !== null, `${label}: ${JSON.stringify(actual)}`)
  for (const [key, value] of Object.entries(expected)) {
    includes((actual as Record<string, unknown>)[key], value, `${label} ${key}`)
  }
}

const idOf = (folder: string) =>
  (JSON.parse(readFileSync(path.join(FIXTURES, folder, 'plugin.json'), 'utf8')) as { id: string }).id

describe('hostile plugins', () => {
  let baseUrl = ''
  let close = () => {}
  let plugins: PluginRegistry
  let adminCookie = ''
  let pluginDir = ''
  let dataDir = ''
  const lines: string[] = []
  const db = openDatabase(':memory:')
  // One throttle for Connexion and for a plugin's password checks, as in start.ts.
  const throttle = new LoginThrottle()
  // Serveur › E-mail set up with a fake transport that records every message, and what Hodi handed it.
  const mails: MailMessage[] = []
  const mailSettings = {
    host: 'smtp.example.test',
    port: 587,
    security: 'starttls' as const,
    user: null,
    password: null,
    sender: 'hodi@example.test',
    appUrl: 'https://hodi.example.test',
    updatedAt: 0
  }

  const call = (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
    fetch(`${baseUrl}/api/plugins${url}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
        cookie: adminCookie
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    })

  const health = async () => {
    const started = Date.now()
    const answer = await fetch(`${baseUrl}/health`)
    return { status: answer.status, ms: Date.now() - started }
  }

  // Hodi's own tables and their row counts.
  const coreDb = () =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
      ({ name }) => `${name}:${(db.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as { n: number }).n}`
    )

  // Every file of the install but the plugin's own data folder, with its size and time.
  const filesOutside = (id: string) => {
    const seen: string[] = []
    const walk = (root: string, base: string) => {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name)
        const relative = path.join(base, entry.name)
        if (relative === path.join('data', 'plugin-data', id)) continue
        if (entry.isDirectory()) walk(full, relative)
        else {
          const stat = statSync(full, { throwIfNoEntry: false })
          seen.push(`${relative}:${stat?.size}:${stat?.mtimeMs}`)
        }
      }
    }
    walk(dataDir, 'data')
    walk(pluginDir, 'plugins')
    return seen.sort()
  }

  const bodyOf = async (answer: Response) => {
    const text = await answer.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }

  // One request of a case, checked as its expected.json says.
  const check = async (id: string, request: Case['requests'][number]) => {
    const { expect } = request
    const started = Date.now()
    const open = request.anonymous === true || request.asCookieOf !== undefined
    const answer = open
      ? await fetch(`${baseUrl}/api/public/plugins/${id}${request.path}`, {
          method: request.method,
          headers: {
            ...(request.rawBody === undefined ? { 'Content-Type': 'application/json' } : {}),
            ...request.headers,
            ...(request.asCookieOf === 'admin' ? { cookie: adminCookie } : {})
          },
          body:
            request.rawBody ??
            (request.bodyBytes === undefined
              ? request.body === undefined
                ? undefined
                : JSON.stringify(request.body)
              : JSON.stringify({ text: 'x'.repeat(request.bodyBytes) }))
        })
      : await call(`/${id}${request.path}`, { method: request.method, headers: request.headers, body: request.body })
    const took = Date.now() - started
    const label = `${request.method} ${request.path}`
    const body = await bodyOf(answer)
    if (expect.status !== undefined) assert.equal(answer.status, expect.status, `${label}: ${JSON.stringify(body)}`)
    if (expect.statusIn) assert.ok(expect.statusIn.includes(answer.status), `${label} answered ${answer.status}`)
    if (expect.withinMs !== undefined) assert.ok(took < expect.withinMs, `${label} took ${took} ms`)
    if (expect.body !== undefined) includes(body, expect.body, label)
    if (expect.everyItem) {
      assert.ok(Array.isArray(body), `${label} answered no list`)
      for (const item of body) includes(item, expect.everyItem, label)
    }
    for (const [name, value] of Object.entries(expect.headers ?? {})) assert.equal(answer.headers.get(name), value)
    for (const name of expect.headersAbsent ?? []) assert.equal(answer.headers.get(name), null, `${label}: ${name}`)
    for (const type of expect.contentTypeNotIn ?? []) {
      assert.ok(!(answer.headers.get('content-type') ?? '').includes(type), `${label}: ${type}`)
    }
    if (expect.cspContains) assert.ok(answer.headers.get('content-security-policy')?.includes(expect.cspContains))
    const keys = Object.keys((body as { keys?: string[] } | null)?.keys ? {} : (body ?? {}))
    const listed = (body as { keys?: string[] } | null)?.keys ?? keys
    if (expect.bodyKeysSubsetOf) for (const key of listed) assert.ok(expect.bodyKeysSubsetOf.includes(key), key)
    if (expect.bodyKeysNotContaining) for (const key of expect.bodyKeysNotContaining) assert.ok(!listed.includes(key))
    return { answer, body }
  }

  before(async () => {
    pluginDir = mkdtempSync(path.join(tmpdir(), 'hodi-hostile-plugins-'))
    dataDir = mkdtempSync(path.join(tmpdir(), 'hodi-hostile-data-'))
    for (const { folder } of cases) {
      cpSync(path.join(FIXTURES, folder), path.join(pluginDir, idOf(folder)), { recursive: true })
    }
    // A well-behaved sign-up beside the hostile ones: what signIn is for.
    mkdirSync(path.join(pluginDir, 'sign-up'))
    writeFileSync(
      path.join(pluginDir, 'sign-up', 'plugin.json'),
      JSON.stringify({
        id: 'sign-up',
        name: 'Sign-up',
        version: '0.0.1',
        description: 'Makes an account and signs the device in',
        api: 2,
        audience: 'admin',
        permissions: { accounts: true, publicRoutes: true, signIn: true, households: true }
      })
    )
    writeFileSync(
      path.join(pluginDir, 'sign-up', 'server.js'),
      `export default {
        // Sensitive: Hodi asks for the person's own password first.
        routes: {
          'DELETE /everything': { proof: true, handler: async request => ({ body: { gone: true, saw: request.body } }) }
        },
        publicRoutes: {
          'POST /signup': async (request, ctx) => {
            const account = await ctx.accounts.create({ email: request.body.email, password: request.body.password })
            return account ? { status: 201, body: {}, signIn: account.id } : { status: 409, body: { error: 'email_taken' } }
          },
          'POST /login': async (request, ctx) => {
            const account = await ctx.accounts.checkPassword(request.body.email, request.body.password)
            return account ? { body: {}, signIn: account.id } : { status: 401, body: {} }
          },
          // As a Google sign-in would, once the plugin checked Google's answer: the person's account, or a new one
          // with no password.
          'POST /google': async (request, ctx) => {
            const login = 'google:' + request.body.sub
            const account =
              (await ctx.accounts.findByLogin(login)) ?? (await ctx.accounts.create({ email: request.body.email, login }))
            return account ? { body: { loginOnly: account.loginOnly }, signIn: account.id } : { status: 409, body: {} }
          },
          // « Lier mon compte Google » after the password: only the account the call checked.
          'POST /link': async (request, ctx) => {
            const account = await ctx.accounts.checkPassword(request.body.email, request.body.password)
            if (!account) return { status: 401, body: {} }
            return { body: { linked: await ctx.accounts.addLogin(account.id, 'google:' + request.body.sub) } }
          },
          // A login for an account the call did not vouch for: refused.
          'POST /steal': async (request, ctx) => {
            const tries = [1, request.body.accountId].map(id =>
              ctx.accounts.addLogin(id, 'google:thief').then(String, error => error.message)
            )
            return { body: await Promise.all(tries) }
          },
          // A household whose admin is an account that already exists: only the one this call checked.
          'POST /household': async (request, ctx) => {
            const admin = request.body.password
              ? await ctx.accounts.checkPassword(request.body.email, request.body.password)
              : { id: request.body.accountId }
            if (!admin) return { status: 401, body: {} }
            return ctx.households
              .create({ name: 'Foyer ' + admin.id, admin: { name: 'Lea', accountId: admin.id } })
              .then(made => ({ body: { made: made.name } }), error => ({ status: 403, body: { error: error.message } }))
          }
        }
      }`
    )
    // H9: the same memory bomb five times.
    for (const letter of 'abcde') {
      const id = `hostile-h9-${letter}`
      cpSync(path.join(FIXTURES, 'H9'), path.join(pluginDir, id), { recursive: true })
      const manifest = JSON.parse(readFileSync(path.join(pluginDir, id, 'plugin.json'), 'utf8')) as { id: string }
      manifest.id = id
      writeFileSync(path.join(pluginDir, id, 'plugin.json'), JSON.stringify(manifest))
    }
    // The fixtures that ask for accounts, households, sign-ins, mail or notifications run only verified: signed here,
    // once their files are final.
    for (const id of readdirSync(pluginDir)) {
      const { permissions = {} } = JSON.parse(readFileSync(path.join(pluginDir, id, 'plugin.json'), 'utf8')) as {
        permissions?: Record<string, unknown>
      }
      if (['accounts', 'households', 'signIn', 'mail', 'notify'].some(key => permissions[key]))
        signTestFolder(path.join(pluginDir, id))
    }
    plugins = await loadPlugins({
      dir: pluginDir,
      trustedKeys: TEST_TRUSTED_KEYS,
      dataDir: path.join(dataDir, 'plugin-data'),
      store: new PluginStore(db),
      // H32's sites, as fetch-text.ts would reach them: every hop checked before it leaves.
      fetchTextFor: isAllowed => async url => {
        const hops = url.includes('redirect') ? [url, 'https://exfil.test/'] : [url]
        for (const hop of hops) if (!(await isAllowed(new URL(hop)))) throw new Error(`Blocked address: ${hop}`)
        return { url: hops.at(-1)!, text: 'page' }
      },
      // The made-up sites are public; any other address goes through the real check.
      isPublicUrl: async url =>
        (url.hostname.endsWith('.test') && url.hostname !== 'rebind.test') || isPublicAddressUrl(url),
      timeoutMs: TIMEOUT_MS,
      accounts: pluginAccounts({ accounts: new UserAccountStore(db), logins: new AccountLoginStore(db), throttle }),
      households: pluginHouseholds({
        store: new PluginHouseholdStore(db),
        accounts: new UserAccountStore(db),
        codes: new SignInCodeStore(db, Buffer.alloc(32, 5)),
        hooks: householdHooks()
      }),
      mail: pluginMailer({
        store: { get: () => mailSettings },
        send: async (_settings, message) => {
          // Exactly what nodemailer would get besides the sender: any other key would be a field the plugin added.
          mails.push({ ...message })
        },
        log: line => lines.push(line)
      }),
      log: line => lines.push(line)
    })

    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 5),
      webDir,
      sourcesFile: 'unused.yml',
      databaseFile: ':memory:',
      backupDir: 'unused-backups',
      timeZone: 'UTC',
      vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
    }
    const catalog = parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n')
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles: new ProfileStore(db),
      household: new HouseholdStore(db),
      accounts: new UserAccountStore(db),
      devices: new UserDeviceStore(db),
      twoFactor: new TwoFactorStore(db, config.sessionSecret),
      throttle,
      plugins
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()

    const cookiesFrom = (response: Response) =>
      response.headers
        .getSetCookie()
        .map(cookie => cookie.split(';')[0])
        .join('; ')
    const account = await fetch(`${baseUrl}/api/setup/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'antho@example.com', password: ADMIN_PASSWORD })
    })
    assert.equal(account.status, 204)
    const session = cookiesFrom(account)
    const setup = await fetch(`${baseUrl}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session },
      body: JSON.stringify({
        name: 'Chez nous',
        profile: { name: 'Antho', color: 'tech' },
        timeZone: 'Europe/Brussels',
        country: 'BE',
        ai: null
      })
    })
    assert.equal(setup.status, 200)
    adminCookie = `${session}; ${cookiesFrom(setup)}`
    // H33 and H34: an adult of the household, and an account of H33's own.
    const store = new UserAccountStore(db)
    store.create('adult@example.test', await hashPassword(ADULT_PASSWORD), Date.now())
    store.create('plug@example.test', await hashPassword('plug-password-1'), Date.now())
    // The list makes each plugin's row the first time it is read: made now, before any case counts the tables.
    assert.equal((await call('')).status, 200)
  })

  after(async () => {
    close()
    await plugins.stop()
    rmSync(pluginDir, { recursive: true, force: true })
    rmSync(dataDir, { recursive: true, force: true })
  })

  // What a case does beyond its requests, by hand.
  const extra: Record<string, (id: string) => Promise<void>> = {
    // The main thread stays free while the plugin spins or runs its query, and the plugin answers again afterwards.
    H4: async id => {
      const spinning = call(`/${id}/spin`)
      await new Promise(resolve => setTimeout(resolve, 500))
      const { status, ms } = await health()
      assert.equal(status, 200)
      assert.ok(ms < 200, `health took ${ms} ms`)
      assert.equal((await spinning).status, 504)
      assert.equal((await call(`/${id}/spin`)).status, 504)
    },
    H7: async id => {
      const querying = call(`/${id}/recursive`)
      await new Promise(resolve => setTimeout(resolve, 500))
      const { status, ms } = await health()
      assert.equal(status, 200)
      assert.ok(ms < 200, `health took ${ms} ms`)
      assert.equal((await querying).status, 504)
    },
    // Five bombs at once: each stops at its memory, or waits for room and is refused; Hodi's memory stays bounded.
    H9: async () => {
      const before = process.memoryUsage().rss
      const answers = await Promise.all([...'abcde'].map(letter => call(`/hostile-h9-${letter}/grow`)))
      for (const answer of answers) assert.ok([500, 503].includes(answer.status), String(answer.status))
      const grown = (process.memoryUsage().rss - before) / 2 ** 20
      assert.ok(grown < 128 + 64, `RSS grew by ${Math.round(grown)} MiB`)
    },
    // Many calls at once: a few run one after the other, the rest are refused at once.
    H11: async id => {
      const answers = await Promise.all(Array.from({ length: 30 }, () => call(`/${id}/slow`)))
      const ok = answers.filter(answer => answer.status === 200).length
      assert.ok(ok >= 1 && ok <= MAX_WAITING_CALLS + 1, `${ok} answered`)
      assert.equal(answers.filter(answer => answer.status === 503).length, answers.length - ok)
    },
    // Far more articles than the plugin can take: telling it never holds the reader up, and the rest are dropped.
    H12: async () => {
      const started = Date.now()
      for (let n = 0; n < 1000; n++) plugins.tellArticle({ id: `a${n}` } as never)
      assert.ok(Date.now() - started < 200)
      for (let tries = 0; tries < 50 && !lines.some(line => line.includes('onArticle dropped 100 ')); tries++) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert.ok(lines.some(line => line.includes('[plugin hostile-h12] onArticle dropped 100 articles')))
      assert.ok(lines.filter(line => line.includes('hostile-h12')).length < 10)
      // Its thread would hold the plugins' memory budget for its queued articles: the next cases need it.
      await plugins.get('hostile-h12')!.sandbox!.stop()
    },
    // A plugin that cannot start is listed with its error, and its code is not run again until Hodi restarts.
    H13: async id => {
      assert.match(plugins.get(id)!.error ?? '', /boom at load/)
      assert.equal(plugins.get(id)!.sandbox, null)
      assert.equal((await call(`/${id}/anything`)).status, 404)
    },
    // The log keeps only so many lines a minute.
    H14: async id => {
      assert.ok(lines.filter(line => line.startsWith(`[plugin ${id}] x`)).length <= 200)
    },
    // The database stops at its size.
    H19: async id => {
      const folder = path.join(dataDir, 'plugin-data', id)
      const bytes = readdirSync(folder).reduce((sum, name) => sum + statSync(path.join(folder, name)).size, 0)
      assert.ok(bytes <= 257 * 2 ** 20, `${bytes} bytes`)
    },
    // An upload over its limit is refused while it is read, and never reaches the plugin.
    H46: async id => {
      const put = async (route: string, body: Uint8Array | ReadableStream<Uint8Array>) => {
        try {
          const answer = await fetch(`${baseUrl}/api/plugins/${id}${route}`, {
            method: 'PUT',
            headers: { cookie: adminCookie, 'Content-Type': 'image/png' },
            body,
            duplex: 'half'
          } as RequestInit)
          return answer.status
        } catch {
          // Hodi may close the connection while the client still sends: the upload failed all the same.
          return 'closed'
        }
      }
      assert.equal(await put('/capture', new Uint8Array(6_000_000)), 413)
      // Sent in chunks, with no length announced: the bytes are counted as they come.
      let sent = 0
      const chunked = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= 20_000_000) controller.close()
          else {
            sent += 1_000_000
            controller.enqueue(new Uint8Array(1_000_000))
          }
        }
      })
      assert.ok([413, 'closed'].includes(await put('/capture', chunked)))
      // A route asking for more than Hodi's ceiling still gets the ceiling.
      assert.equal(await put('/big', new Uint8Array(11_000_000)), 413)
      assert.deepEqual(await (await call(`/${id}/reached`)).json(), { reached: 0 })
    },
    // 40 requests at once from one address: 10 are refused before the plugin's code. The other 30 reach it; those
    // its sandbox cannot queue (H11) are refused busy, and the plugin counted exactly the ones it answered. Another
    // address still gets in. A proxy on this machine names the visitor in X-Forwarded-For (client-address.ts), as the
    // tests' loopback does.
    H37: async id => {
      const answers = await Promise.all(
        Array.from({ length: 40 }, () =>
          fetch(`${baseUrl}/api/public/plugins/${id}/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          })
        )
      )
      const statuses = answers.map(answer => answer.status)
      assert.equal(statuses.filter(status => status === 429).length, 10)
      assert.ok(
        statuses.every(status => [200, 429, 503].includes(status)),
        statuses.join(' ')
      )
      const ran = statuses.filter(status => status === 200).length
      assert.ok(ran >= 1)
      const count = await fetch(`${baseUrl}/api/public/plugins/${id}/count`, {
        headers: { 'X-Forwarded-For': '203.0.113.9' }
      })
      assert.equal(count.status, 200)
      assert.deepEqual(await count.json(), { n: ran })
      // The 30 of this minute are spent: one more from the first address is refused, the plugin never runs.
      const more = await fetch(`${baseUrl}/api/public/plugins/${id}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })
      assert.equal(more.status, 429)
      assert.deepEqual(
        await (
          await fetch(`${baseUrl}/api/public/plugins/${id}/count`, { headers: { 'X-Forwarded-For': '203.0.113.9' } })
        ).json(),
        { n: ran }
      )
    },
    // Header injection, several recipients, HTML, an attachment naming a file, another sender: the core builds the
    // message from to, subject and text only.
    H38: async id => {
      const results = (await (await call(`/${id}/mail`, { method: 'POST' })).json()) as { ok: boolean }[]
      for (const index of [0, 1, 2, 3]) assert.equal(results[index]!.ok, false, `try ${index}`)
      assert.ok(mails.length <= 4)
      for (const mail of mails) {
        assert.deepEqual(Object.keys(mail).sort(), ['subject', 'text', 'to'])
        assert.equal(mail.to, 'a@example.test')
        assert.doesNotMatch(mail.subject, /[\r\n]/)
        assert.ok(
          mail.text.endsWith('-- \nEnvoyé par le plugin Hostile H38 de Hodi, https://hodi.example.test'),
          mail.text
        )
      }
      mails.length = 0
    },
    // 60 in a row: 50 leave, then mail_limit, said once in the log and still counted on the next call.
    H39: async id => {
      assert.equal(mails.length, 50)
      assert.equal(lines.filter(line => line.startsWith(`[plugin ${id}] reached 50 e-mails`)).length, 1)
      const again = (await (await call(`/${id}/flood`, { method: 'POST' })).json()) as unknown
      assert.deepEqual(again, { sent: 0, refused: 'mail_limit' })
      assert.equal(mails.length, 50)
      assert.equal(lines.filter(line => line.startsWith(`[plugin ${id}] reached 50 e-mails`)).length, 1)
      mails.length = 0
    },
    // 200 guesses from one address: only the throttle's allowance is hashed, the rest refused at once. Meanwhile the
    // admin signs in from elsewhere without waiting, and Connexion then refuses that address too.
    H49: async id => {
      const guesser = { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.49' }
      const started = Date.now()
      const guessing = fetch(`${baseUrl}/api/public/plugins/${id}/guess`, {
        method: 'POST',
        headers: guesser,
        body: JSON.stringify({ email: 'antho@example.com' })
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      const signIn = Date.now()
      const login = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'antho@example.com', password: ADMIN_PASSWORD })
      })
      assert.equal(login.status, 204)
      assert.ok(Date.now() - signIn < 2_000, `sign-in took ${Date.now() - signIn} ms`)
      const guessed = await guessing
      assert.equal(guessed.status, 200)
      assert.deepEqual(await guessed.json(), { tried: 200, refused: 200 - DEFAULT_MAX_FAILURES })
      assert.ok(Date.now() - started < TIMEOUT_MS)
      const again = await fetch(`${baseUrl}/api/login`, {
        method: 'POST',
        headers: guesser,
        body: JSON.stringify({ email: 'antho@example.com', password: ADMIN_PASSWORD })
      })
      assert.equal(again.status, 429)
    },
    // Suspend and remove fail on every household the plugin did not make; its own goes, with all it held.
    H35: async id => {
      const results = (await (await call(`/${id}/wipe`, { method: 'POST' })).json()) as { name: string; ok: boolean }[]
      for (const result of results) assert.equal(result.ok, result.name === 'remove own', result.name)
      assert.ok(
        results.some(result => result.name === 'suspend 1') && results.some(result => result.name === 'remove 2')
      )
      for (const household of [1, 2]) {
        assert.equal(coreHousehold(household)?.suspended_at, null)
        assert.ok(profilesOf(household) > 0)
      }
      const made = db.prepare('SELECT count(*) AS n FROM accounts WHERE made_by_plugin = ?').get(id) as { n: number }
      assert.equal(made.n, 0)
    },
    // The refused move left the device where it was and is in the plugin's log.
    H50: async id => {
      assert.ok(lines.some(line => line.startsWith(`[plugin ${id}] POST /move: moveDevice refused for household 2`)))
    },
    // Every way to a session for an account the call did not make or check was refused, written in the plugin's log,
    // and made no session.
    H33: async id => {
      const refused = lines.filter(line => line.startsWith(`[plugin ${id}]`) && line.includes('signIn refused'))
      assert.ok(refused.length >= 5, refused.join('\n'))
      assert.equal((db.prepare('SELECT count(*) AS n FROM user_devices').get() as { n: number }).n, devicesBefore)
    },
    // checkSignIn refuses, throws, loops, answers markup, then lets in: the adult follows it, the server's admin never
    // waits for it.
    H34: async id => {
      const signIn = async (email: string, password: string) => {
        const started = Date.now()
        const answer = await fetch(`${baseUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        })
        const body = answer.status === 204 ? null : ((await answer.json()) as unknown)
        return { status: answer.status, body, ms: Date.now() - started }
      }
      const adult = () => signIn('adult@example.test', ADULT_PASSWORD)
      const admin = () => signIn('antho@example.com', ADMIN_PASSWORD)
      const mode = (value: string) => plugins.store.updateSettings(id, { mode: value })
      const neutral = { error: 'sign_in_refused', plugin: id, message: null }

      mode('refuse')
      assert.equal((await adult()).status, 403)
      assert.deepEqual((await adult()).body, { error: 'sign_in_refused', plugin: id, message: 'signIn.nope' })
      assert.equal((await admin()).status, 204)

      mode('throw')
      assert.deepEqual((await adult()).body, neutral)
      assert.equal((await admin()).status, 204)

      mode('loop')
      const looping = adult()
      const meanwhile = await admin()
      assert.equal(meanwhile.status, 204)
      assert.ok(meanwhile.ms < 2_000, `the admin waited ${meanwhile.ms} ms`)
      const looped = await looping
      assert.deepEqual(looped.body, neutral)
      assert.ok(looped.ms < TIMEOUT_MS + 1_000, `the refusal took ${looped.ms} ms`)

      mode('html')
      assert.deepEqual((await adult()).body, neutral)

      mode('pass')
      assert.equal((await adult()).status, 204)
    },
    // Nothing a plugin answers changes an object in Hodi.
    H27: async () => {
      assert.equal(({} as Record<string, unknown>).admin, undefined)
      assert.equal(({} as Record<string, unknown>).isAdmin, undefined)
    },
    // A plugin for API 1 is listed, and none of its code ran.
    // Nobody signed it: its routes run, its web part is neither listed nor served, even to the admin.
    H43: async id => {
      const listed = (await (await call('')).json()) as { plugins: { id: string; signed: boolean; web: unknown }[] }
      const plugin = listed.plugins.find(candidate => candidate.id === id)
      assert.deepEqual(
        [plugin?.signed, plugin?.web],
        [false, { script: false, style: false, publicScript: false, publicStyle: false, locales: [] }]
      )
      assert.equal((await call(`/${id}/files/web.js`)).status, 404)
    },
    H41: async id => {
      assert.equal(plugins.get(id)!.error, OUTDATED_API)
      assert.equal(existsSync('/tmp/hostile-h41-ran'), false)
      const source = readdirSync(path.join(path.dirname(FIXTURES), '..', '..', 'plugins'), { recursive: true })
        .map(String)
        .filter(name => name.endsWith('.ts'))
        .map(name => readFileSync(path.join(path.dirname(FIXTURES), '..', '..', 'plugins', name), 'utf8'))
        .join('\n')
      assert.doesNotMatch(source, /\bimport\(/)
    }
  }

  // What a case needs before its requests.
  let devicesBefore = 0
  const coreHousehold = (id: number) =>
    db.prepare('SELECT id, name, suspended_at FROM accounts WHERE id = ?').get(id) as
      { id: number; name: string; suspended_at: number | null } | undefined
  const profilesOf = (id: number) =>
    (db.prepare('SELECT count(*) AS n FROM profiles WHERE account_id = ?').get(id) as { n: number }).n
  const prepare: Record<string, (id: string) => void> = {
    // A second household made by the core, as Serveur › Foyers would: no plugin made it.
    H35: () => {
      db.prepare(
        "INSERT INTO accounts (id, name, created_at, set_up_at, language) VALUES (2, 'Famille Martin', ?, ?, 'fr')"
      ).run(Date.now(), Date.now())
      db.prepare(
        "INSERT INTO profiles (account_id, name, color, position, created_at, role) VALUES (2, 'Marie', 'world', 0, ?, 'admin')"
      ).run(Date.now())
    },
    H33: () => {
      devicesBefore = (db.prepare('SELECT count(*) AS n FROM user_devices').get() as { n: number }).n
    }
  }

  for (const hostile of cases) {
    const todo = TODO[hostile.folder]
    it(`${hostile.case}: ${hostile.title}`, todo ? { todo } : {}, async () => {
      const id = hostile.folder.startsWith('H9') ? 'hostile-h9-a' : idOf(hostile.folder)
      const tables = coreDb()
      prepare[hostile.case]?.(id)
      const files = filesOutside(id)
      // H9 and H11 send their requests their own way.
      if (!['H9', 'H11', 'H35', 'H37', 'H38'].includes(hostile.case))
        for (const request of hostile.requests ?? []) await check(id, request)
      await extra[hostile.case]?.(id)
      for (const always of hostile.alwaysCheck ?? []) {
        if (always === 'health') assert.equal((await health()).status, 200)
        if (always === 'coreDbUnchanged') assert.deepEqual(coreDb(), tables)
        if (always === 'noFileOutsidePluginDir') assert.deepEqual(filesOutside(id), files)
      }
    })
  }

  it('moves a device to another household of its account, then reads there', async () => {
    // The admin's account gets a profile in household 2 (made for H35).
    db.prepare(
      "INSERT INTO profiles (account_id, name, color, position, created_at, role, user_id) VALUES (2, 'Antho', 'world', 1, ?, 'member', 1)"
    ).run(Date.now())
    const names = async () =>
      (
        (await (await fetch(`${baseUrl}/api/profiles`, { headers: { cookie: adminCookie } })).json()) as {
          profiles: { name: string }[]
        }
      ).profiles.map(profile => profile.name)
    assert.ok(!(await names()).includes('Marie'))
    const moved = await call('/hostile-h50/move', { method: 'POST', body: { householdId: 2 } })
    assert.equal(moved.status, 200)
    assert.ok(
      moved.headers.getSetCookie().some(cookie => cookie.startsWith('hodi_profile=;')),
      'profile cleared'
    )
    assert.ok((await names()).includes('Marie'))
    // Back where the other cases expect it. Once the account has no profile there, the device reads in its first.
    db.prepare('DELETE FROM profiles WHERE account_id = 2 AND user_id = 1').run()
    assert.ok(!(await names()).includes('Marie'))
    db.prepare('UPDATE user_devices SET household_id = NULL').run()
  })

  it('signs a device in with an account the call made or checked, never the server admin', async () => {
    const post = (route: string, body: unknown) =>
      fetch(`${baseUrl}/api/public/plugins/sign-up${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.33' },
        body: JSON.stringify(body)
      })
    const sessionWith = async (answer: Response) => {
      const cookie = answer.headers
        .getSetCookie()
        .map(line => line.split(';')[0])
        .join('; ')
      return cookie ? (await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).status : null
    }
    const made = await post('/signup', { email: 'new@example.test', password: 'une phrase solide' })
    assert.equal(made.status, 201)
    assert.equal(await sessionWith(made), 200)
    assert.equal((await post('/signup', { email: 'new@example.test', password: 'une phrase solide' })).status, 409)
    const checked = await post('/login', { email: 'adult@example.test', password: ADULT_PASSWORD })
    assert.equal(checked.status, 200)
    assert.equal(await sessionWith(checked), 200)
    // The right password of the server's admin is no way in through a plugin.
    const admin = await post('/login', { email: 'antho@example.com', password: ADMIN_PASSWORD })
    assert.equal(admin.status, 200)
    assert.equal(await sessionWith(admin), null)
    assert.ok(lines.some(line => line.startsWith('[plugin sign-up] POST /login: signIn refused for account 1')))
  })

  it('signs a person in with a login of the plugin, made only for an account the call vouched for', async () => {
    const post = (route: string, body: unknown) =>
      fetch(`${baseUrl}/api/public/plugins/sign-up${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.34' },
        body: JSON.stringify(body)
      })
    const sessionWith = async (answer: Response) => {
      const cookie = answer.headers
        .getSetCookie()
        .map(line => line.split(';')[0])
        .join('; ')
      return cookie ? (await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).status : null
    }
    // A new person: an account with no password, signed in; the second time, the same account.
    const first = await post('/google', { sub: '42', email: 'google@example.test' })
    assert.deepEqual([first.status, await first.json()], [200, { loginOnly: true }])
    assert.equal(await sessionWith(first), 200)
    const again = await post('/google', { sub: '42', email: 'ignored@example.test' })
    assert.equal(await sessionWith(again), 200)
    const made = db.prepare("SELECT id, has_password FROM users WHERE email = 'google@example.test'").get() as {
      id: number
      has_password: number
    }
    assert.equal(made.has_password, 0)
    // No password signs that account in at « Connexion ».
    const typed = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.35' },
      body: JSON.stringify({ email: 'google@example.test', password: '' })
    })
    assert.equal(typed.status, 400)
    // An adult links Google after typing the password; the login then signs them in.
    const linked = await post('/link', { email: 'adult@example.test', password: ADULT_PASSWORD, sub: '7' })
    assert.deepEqual(await linked.json(), { linked: true })
    const adult = await post('/google', { sub: '7', email: 'adult@example.test' })
    assert.deepEqual([adult.status, await adult.json()], [200, { loginOnly: false }])
    assert.equal(await sessionWith(adult), 200)
    // A login for the server's admin or anyone the call did not vouch for is refused.
    assert.deepEqual(await (await post('/steal', { accountId: made.id })).json(), ['not_vouched', 'not_vouched'])
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM account_logins WHERE login = 'google:thief'").get() as { n: number }).n,
      0
    )
  })

  it("asks for the app's code in Hodi's dialog when a plugin signs in an account with two-step on", async () => {
    const post = (route: string, body: unknown) =>
      fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.37' },
        body: JSON.stringify(body)
      })
    const plugin = (route: string, body: unknown) => post(`/api/public/plugins/sign-up${route}`, body)
    assert.equal(
      (await plugin('/signup', { email: 'careful@example.test', password: 'une phrase solide' })).status,
      201
    )
    const { id } = db.prepare("SELECT id FROM users WHERE email = 'careful@example.test'").get() as { id: number }
    const twoFactor = new TwoFactorStore(db, Buffer.alloc(32, 5))
    const { secret } = twoFactor.start(id, 'careful@example.test', Date.now())
    const codeAt = (at: number) =>
      new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: at })
    assert.ok(twoFactor.confirm(id, codeAt(Date.now() - 30_000), Date.now()))
    // The right password, checked by the plugin: its answer goes on, with no session but the ticket of the second step.
    const checked = await plugin('/login', { email: 'careful@example.test', password: 'une phrase solide' })
    assert.equal(checked.status, 200)
    assert.deepEqual(checked.headers.getSetCookie(), [])
    const ticket = checked.headers.get('Hodi-Second-Step')
    assert.match(ticket ?? '', /^[\w-]{43}$/)
    // A wrong code, then a made-up ticket: still no session.
    const wrong = await post('/api/login/second-step', { ticket, code: '000000' })
    assert.deepEqual([wrong.status, await wrong.json()], [403, { error: 'invalid_code' }])
    const forged = await post('/api/login/second-step', { ticket: 'x'.repeat(43), code: codeAt(Date.now()) })
    assert.deepEqual([forged.status, await forged.json()], [403, { error: 'second_step_expired' }])
    // The app's code: the device signs in, once.
    const right = await post('/api/login/second-step', { ticket, code: codeAt(Date.now()) })
    assert.equal(right.status, 204)
    const cookie = right.headers
      .getSetCookie()
      .map(line => line.split(';')[0])
      .join('; ')
    assert.equal((await fetch(`${baseUrl}/api/session`, { headers: { cookie } })).status, 200)
    const again = await post('/api/login/second-step', { ticket, code: codeAt(Date.now() + 30_000) })
    assert.deepEqual([again.status, await again.json()], [403, { error: 'second_step_expired' }])
    // The same through a login of the plugin: never a session without the code.
    const link = await plugin('/link', { email: 'careful@example.test', password: 'une phrase solide', sub: '9' })
    assert.deepEqual(await link.json(), { linked: true })
    const google = await plugin('/google', { sub: '9', email: 'careful@example.test' })
    assert.deepEqual([google.status, await google.json()], [200, { loginOnly: false }])
    assert.deepEqual(google.headers.getSetCookie(), [])
    assert.ok(google.headers.get('Hodi-Second-Step'))
  })

  it('runs a route marked proof only once Hodi checked the password typed in its dialog', async () => {
    const proofOf = (typed: unknown) => Buffer.from(JSON.stringify(typed)).toString('base64')
    const remove = (headers: Record<string, string> = {}) =>
      call('/sign-up/everything', { method: 'DELETE', headers: { 'X-Forwarded-For': '203.0.113.38', ...headers } })
    const none = await remove()
    assert.deepEqual([none.status, await none.json()], [403, { error: 'proof_required' }])
    const garbled = await remove({ 'Hodi-Proof': 'not base64 json' })
    assert.deepEqual([garbled.status, await garbled.json()], [403, { error: 'proof_required' }])
    const wrong = await remove({ 'Hodi-Proof': proofOf({ password: 'not-it' }) })
    assert.deepEqual([wrong.status, await wrong.json()], [403, { error: 'invalid_password' }])
    // The plugin never sees what was typed: only its own body.
    const right = await remove({ 'Hodi-Proof': proofOf({ password: ADMIN_PASSWORD }) })
    assert.deepEqual([right.status, await right.json()], [200, { gone: true, saw: null }])
  })

  it('makes a household for an existing account only when the call checked that account', async () => {
    const post = (body: unknown) =>
      fetch(`${baseUrl}/api/public/plugins/sign-up/household`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.36' },
        body: JSON.stringify(body)
      })
    const adult = db.prepare("SELECT id FROM users WHERE email = 'adult@example.test'").get() as { id: number }
    const households = () => (db.prepare('SELECT count(*) AS n FROM accounts').get() as { n: number }).n
    const before = households()
    // Only its id: the plugin never asked that person anything.
    const taken = await post({ accountId: adult.id })
    assert.deepEqual([taken.status, await taken.json()], [403, { error: 'not_vouched' }])
    assert.equal(households(), before)
    // The person typed their password: the household is theirs.
    const asked = await post({ email: 'adult@example.test', password: ADULT_PASSWORD })
    assert.deepEqual([asked.status, await asked.json()], [200, { made: `Foyer ${adult.id}` }])
    assert.equal(households(), before + 1)
  })

  it('keeps a memory bomb inside what one plugin thread may use', async () => {
    const before = process.memoryUsage().rss
    assert.equal((await call('/hostile-h8/grow')).status, 500)
    const grown = (process.memoryUsage().rss - before) / 2 ** 20
    assert.ok(grown < threadCostMb(16), `RSS grew by ${Math.round(grown)} MiB`)
  })
})
