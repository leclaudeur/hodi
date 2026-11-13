import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { MailSettingsStore } from '../db/mail-settings-store.ts'
import { PasswordResetStore, RESET_LINK_INTERVAL, RESET_LINK_LIFETIME } from '../db/password-reset-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import type { MailMessage } from '../mail/mailer.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'
import { TwoFactorStore } from '../db/two-factor-store.ts'
import { Secret, TOTP } from 'otpauth'

const PASSWORD = 'une phrase de passe assez longue'
const NEW_PASSWORD = 'une toute nouvelle phrase de passe'

describe('password reset links', () => {
  it('works once, for an hour, and one a minute at most', () => {
    const db = openDatabase(':memory:')
    const resets = new PasswordResetStore(db, Buffer.alloc(32, 5))
    db.prepare(
      "INSERT INTO users (email, password_hash, password_changed_at, created_at) VALUES ('a@example.com', 'x', 0, 0)"
    ).run()
    const token = resets.create(1, 0)!
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(resets.create(1, RESET_LINK_INTERVAL - 1), null)
    assert.equal(resets.peek(token, RESET_LINK_LIFETIME - 1), 1)
    assert.equal(resets.peek(token, RESET_LINK_LIFETIME), null)
    // A new link replaces the one before.
    const next = resets.create(1, RESET_LINK_INTERVAL)!
    assert.equal(resets.peek(token, RESET_LINK_INTERVAL), null)
    assert.equal(resets.take(next, RESET_LINK_INTERVAL), 1)
    assert.equal(resets.take(next, RESET_LINK_INTERVAL), null)
    // Only a hash is kept.
    const kept = db.prepare('SELECT token_hash FROM password_resets').all() as { token_hash: string }[]
    assert.ok(kept.every(row => row.token_hash !== next))
  })
})

describe('Mot de passe oublié', () => {
  let baseUrl = ''
  let close: () => void
  let clock = Date.UTC(2026, 10, 6, 21, 0)
  const db = openDatabase(':memory:')
  const mail = new MailSettingsStore(db)
  const sent: MailMessage[] = []
  const twoFactor = new TwoFactorStore(db, Buffer.alloc(32, 3))

  const post = (url: string, body: unknown, cookie = '') =>
    fetch(`${baseUrl}/api${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(body)
    })
  const cookiesFrom = (response: Response) =>
    response.headers
      .getSetCookie()
      .map(cookie => cookie.split(';')[0])
      .join('; ')
  const linkOf = (message: MailMessage) => /#\/reset\/([A-Za-z0-9_-]{43})/.exec(message.text)?.[1]
  const setup = async () => (await (await fetch(`${baseUrl}/api/setup`)).json()) as { resetByMail?: boolean }
  // The e-mail leaves after the answer.
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))

  before(async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 3),
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
      serverMail: {
        store: mail,
        send: async (_settings, message) => {
          sent.push(message)
        }
      },
      passwordResets: new PasswordResetStore(db, Buffer.alloc(32, 4)),
      twoFactor,
      now: () => clock
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()

    const account = await post('/setup/account', { email: 'antho@example.com', password: PASSWORD })
    await post(
      '/setup',
      {
        name: 'Chez nous',
        profile: { name: 'Antho', color: 'tech' },
        timeZone: 'Europe/Brussels',
        country: 'BE',
        ai: null
      },
      cookiesFrom(account)
    )
  })

  after(() => close())

  it('is offered only once Serveur › E-mail can send its link', async () => {
    assert.equal((await setup()).resetByMail, false)
    assert.equal((await post('/password/forgot', { email: 'antho@example.com' })).status, 404)
    mail.set({ host: 'smtp.example.com', port: 587, security: 'starttls', user: null, sender: 'hodi@example.com' }, 0)
    // Without Hodi's address, a link could not say where to go.
    assert.equal((await setup()).resetByMail, false)
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
    assert.equal((await setup()).resetByMail, true)
  })

  it('answers the same for an unknown address, and sends nothing then', async () => {
    const unknown = await post('/password/forgot', { email: 'personne@example.com' })
    assert.equal(unknown.status, 202)
    await settle()
    assert.equal(sent.length, 0)
    assert.equal((await post('/password/forgot', { email: 'pas une adresse' })).status, 400)
  })

  it('sends a link that sets a new password once, and signs the other devices out', async () => {
    const other = cookiesFrom(await post('/login', { email: 'antho@example.com', password: PASSWORD }))
    assert.equal((await fetch(`${baseUrl}/api/session`, { headers: { cookie: other } })).status, 200)

    const asked = await post('/password/forgot', { email: 'Antho@Example.com' })
    assert.equal(asked.status, 202)
    await settle()
    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.to, 'antho@example.com')
    assert.match(sent[0]!.text, /https:\/\/hodi\.example\.com\/#\/reset\//)
    const token = linkOf(sent[0]!)!

    // A second ask within the minute sends nothing more.
    await post('/password/forgot', { email: 'antho@example.com' })
    await settle()
    assert.equal(sent.length, 1)

    assert.deepEqual(await (await post('/password/check', { token })).json(), { email: 'antho@example.com' })
    assert.equal((await post('/password/check', { token: 'x'.repeat(43) })).status, 404)
    assert.equal((await post('/password/reset', { token, password: 'court' })).status, 400)

    const reset = await post('/password/reset', { token, password: NEW_PASSWORD })
    assert.equal(reset.status, 204)
    const here = cookiesFrom(reset)
    assert.match(here, /hodi_profile/)
    assert.equal((await fetch(`${baseUrl}/api/session`, { headers: { cookie: here } })).status, 200)
    // The device signed in before asks again.
    assert.equal((await fetch(`${baseUrl}/api/session`, { headers: { cookie: other } })).status, 401)
    assert.equal((await post('/password/reset', { token, password: NEW_PASSWORD })).status, 404)
    assert.equal((await post('/login', { email: 'antho@example.com', password: PASSWORD })).status, 401)
    assert.equal((await post('/login', { email: 'antho@example.com', password: NEW_PASSWORD })).status, 204)
  })

  it('works an hour only', async () => {
    clock += RESET_LINK_INTERVAL
    await post('/password/forgot', { email: 'antho@example.com' })
    await settle()
    const token = linkOf(sent.at(-1)!)!
    clock += RESET_LINK_LIFETIME
    assert.equal((await post('/password/check', { token })).status, 404)
    assert.equal((await post('/password/reset', { token, password: NEW_PASSWORD })).status, 404)
  })

  it('signs in on Connexion after the new password, with the app’s code, when the account asks for it', async () => {
    clock += RESET_LINK_INTERVAL
    const { secret } = twoFactor.start(1, 'antho@example.com', clock)
    const appCode = () =>
      new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: clock })
    assert.ok(twoFactor.confirm(1, appCode(), clock))
    await post('/password/forgot', { email: 'antho@example.com' })
    await settle()
    const token = linkOf(sent.at(-1)!)!
    const reset = await post('/password/reset', { token, password: PASSWORD })
    assert.equal(reset.status, 200)
    assert.deepEqual(await reset.json(), { signIn: false })
    // No session: a link in a mailbox is not the phone.
    assert.deepEqual(reset.headers.getSetCookie(), [])
    const login = await post('/login', { email: 'antho@example.com', password: PASSWORD })
    assert.equal(login.status, 403)
    assert.deepEqual(await login.json(), { error: 'two_factor_required' })
    clock += 30_000
    assert.equal(
      (await post('/login', { email: 'antho@example.com', password: PASSWORD, code: appCode() })).status,
      204
    )
  })
})
