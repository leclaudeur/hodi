import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import { hashPassword } from '../auth/password.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { MailSettingsStore } from '../db/mail-settings-store.ts'
import { PasswordResetStore } from '../db/password-reset-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { HANDLED_KEPT, ServerInboxStore } from '../db/server-inbox-store.ts'
import { ServerNoticeStore } from '../db/server-notice-store.ts'
import { ServerPeopleStore } from '../db/server-people-store.ts'
import { ServerStatsStore } from '../db/server-stats-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import type { MailMessage } from '../mail/mailer.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { serverNotifier } from '../notices/server-notifier.ts'
import { fakeFetch } from './helpers/news.ts'

const PASSWORD = 'une phrase de passe assez longue'

describe('Serveur › Notifications’ list', () => {
  it('keeps each request in each language, once while it waits, and not a notice that asks nothing', async () => {
    const db = openDatabase(':memory:')
    const accounts = new UserAccountStore(db)
    accounts.createServerAdmin('admin@example.test', 'hash', 0)
    const inbox = new ServerInboxStore(db)
    let clock = 10
    const notifier = serverNotifier({
      store: new ServerNoticeStore(db),
      admins: () => accounts.serverAdmins(),
      mail: { settings: () => null, send: async () => {} },
      push: async () => {},
      languageOf: () => 'fr',
      inbox,
      now: () => clock
    })
    const notice = (language: string) => ({ from: 'Serveur', title: `Titre ${language}`, text: 'Texte', url: '#/x' })
    await notifier.tell('core:weekly-report', notice)
    await notifier.tell('core:code-request', notice, { important: 'code-request:2' })
    clock = 20
    // The same request, asked again while it waits: nothing more.
    await notifier.tell('core:code-request', notice, { important: 'code-request:2' })
    const items = inbox.list(clock)
    assert.equal(items.length, 1)
    assert.equal(items[0]?.texts.en?.title, 'Titre en')
    assert.equal(items[0]?.texts.fr?.title, 'Titre fr')
    assert.deepEqual(
      items.map(item => [item.type, item.important, item.handledAt]),
      [['core:code-request', true, null]]
    )
    assert.equal(inbox.waiting('code-request:2'), 10)
    inbox.handle('code-request:2', 30)
    assert.equal(inbox.waiting('code-request:2'), null)
    assert.equal(inbox.list(30)[0]?.handledAt, 30)
    // Handled, a new request is told again.
    await notifier.tell('core:code-request', notice, { important: 'code-request:2' })
    assert.equal(inbox.list(30).length, 2)
    // A week after it was handled, the first one goes; the one waiting stays, however old.
    assert.deepEqual(
      inbox.list(30 + HANDLED_KEPT + 1).map(item => item.handledAt),
      [null]
    )
    // The next request takes it away for good.
    clock = 30 + HANDLED_KEPT + 1
    await notifier.tell('core:code-request', notice, { important: 'code-request:3' })
    assert.deepEqual(
      inbox.list(0).map(item => item.handledAt),
      [null, null]
    )
  })
})

describe('« Demander un code »', () => {
  let baseUrl = ''
  let close: () => void
  let admin = ''
  let samId = 0
  const db = openDatabase(':memory:')
  const mail = new MailSettingsStore(db)
  const inbox = new ServerInboxStore(db)
  const accounts = new UserAccountStore(db)
  const sent: MailMessage[] = []

  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  const cookiesFrom = (response: Response) =>
    response.headers
      .getSetCookie()
      .map(cookie => cookie.split(';')[0])
      .join('; ')
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))

  before(async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 6),
      webDir,
      sourcesFile: 'unused.yml',
      databaseFile: ':memory:',
      backupDir: 'unused-backups',
      timeZone: 'UTC',
      vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
    }
    const catalog = parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n')
    const notices = new ServerNoticeStore(db)
    const send = async (_settings: unknown, message: MailMessage) => void sent.push(message)
    const notifier = serverNotifier({
      store: notices,
      admins: () => accounts.serverAdmins(),
      mail: { settings: () => mail.get(), send },
      push: async () => {},
      languageOf: () => 'fr',
      inbox
    })
    const profiles = new ProfileStore(db)
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles,
      household: new HouseholdStore(db),
      accounts,
      devices: new UserDeviceStore(db),
      codes: new SignInCodeStore(db, config.sessionSecret),
      serverMail: { store: mail, send },
      serverNotices: { store: notices, publicKey: '' },
      serverInbox: { store: inbox, notifier },
      serverPeople: new ServerPeopleStore(db),
      serverStats: new ServerStatsStore(db, () => 'UTC'),
      passwordResets: new PasswordResetStore(db, Buffer.alloc(32, 4))
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()

    const account = await call('/setup/account', '', 'POST', { email: 'claire@example.com', password: PASSWORD })
    const done = await call('/setup', cookiesFrom(account), 'POST', {
      name: 'Famille Dupont',
      profile: { name: 'Claire', color: 'tech' },
      timeZone: 'Europe/Brussels',
      ai: null
    })
    admin = `${cookiesFrom(account)}; ${cookiesFrom(done)}`
    const sam = profiles.create('Sam', 'world', Date.now())!
    const user = accounts.create('sam@example.com', await hashPassword(PASSWORD), Date.now())!
    accounts.linkProfile(user.id, sam.id)
    samId = user.id
  })

  after(() => close())

  it('tells the server’s admin once, and shows it on the account until a code is made', async () => {
    // Before Sam asks, the server's admin cannot make one: nobody takes an account over on their own.
    const samCode = `/server/accounts/${samId}/code`
    const before = await call(samCode, admin, 'POST', { password: PASSWORD })
    assert.equal(before.status, 409)
    assert.deepEqual(await before.json(), { error: 'not_asked' })
    assert.equal((await call('/password/ask', '', 'POST', { email: 'pas une adresse' })).status, 400)
    assert.equal((await call('/password/ask', '', 'POST', { email: 'Sam@Example.com' })).status, 202)
    // An address without an account gets the same answer, and nobody is told.
    assert.equal((await call('/password/ask', '', 'POST', { email: 'nobody@example.com' })).status, 202)
    await call('/password/ask', '', 'POST', { email: 'sam@example.com' })
    await settle()

    const inboxAnswer = await call('/server/inbox', admin)
    assert.equal(inboxAnswer.status, 200)
    const answer = (await inboxAnswer.json()) as {
      items: { type: string; important: boolean; url: string; texts: { fr: { title: string } } }[]
      waiting: number
    }
    assert.equal(answer.waiting, 1)
    assert.equal(answer.items.length, 1)
    assert.equal(answer.items[0]?.texts.fr.title, 'Sam demande un code')
    assert.equal(answer.items[0]?.url, `#/server/accounts/${samId}`)
    const people = (await (await call('/server/accounts', admin)).json()) as {
      accounts: { id: number; codeAskedAt: number | null }[]
    }
    assert.ok(people.accounts.find(account => account.id === samId)?.codeAskedAt)
    assert.equal(people.accounts.find(account => account.id !== samId)?.codeAskedAt, null)
    // Without Serveur › E-mail, nothing goes by e-mail.
    assert.equal(sent.length, 0)
    // Nobody can silence it: someone waits on it.
    const silenced = await call('/server/notifications/kinds/core:code-request', admin, 'PUT', {
      email: false,
      push: false
    })
    assert.equal(silenced.status, 400)
    assert.equal((await call('/server/inbox', '')).status, 401)

    // Asked: one code, and the request is handled, so a second one waits for Sam to ask again.
    assert.equal((await call(samCode, admin, 'POST', { password: PASSWORD })).status, 201)
    assert.equal((await call(samCode, admin, 'POST', { password: PASSWORD })).status, 409)
  })

  it('makes no code from a request older than a week, and counts a new one from when it is made', async () => {
    const samCode = `/server/accounts/${samId}/code`
    const eightDays = 8 * 24 * 60 * 60 * 1000
    inbox.add({ type: 'core:code-request', texts: {}, url: '', key: `code-request:${samId}` }, Date.now() - eightDays)
    assert.equal((await call(samCode, admin, 'POST', { password: PASSWORD })).status, 409)
    const listed = (await (await call('/server/accounts', admin)).json()) as {
      accounts: { id: number; codeAskedAt: number | null }[]
    }
    assert.equal(listed.accounts.find(account => account.id === samId)?.codeAskedAt, null)

    // Sam asks again: the old request closes, the new one counts.
    await call('/password/ask', '', 'POST', { email: 'sam@example.com' })
    await settle()
    assert.equal((await call(samCode, admin, 'POST', { password: PASSWORD })).status, 201)
  })

  it('is « Mot de passe oublié »’s e-mail instead, once Serveur › E-mail is set', async () => {
    mail.set(
      {
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
        user: null,
        sender: 'hodi@example.com',
        appUrl: 'https://hodi.example.com'
      },
      0
    )
    assert.equal((await call('/password/ask', '', 'POST', { email: 'sam@example.com' })).status, 404)
  })
})
