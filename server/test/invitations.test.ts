import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { openDatabase } from '../db/database.ts'
import { InstallStore } from '../db/install-store.ts'
import { MailSettingsStore } from '../db/mail-settings-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { INVITATION_MAILS_PER_DAY } from '../http/invitation-routes.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import type { MailMessage } from '../mail/mailer.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const PASSWORD = 'une phrase de passe assez longue'

interface Invitation {
  id: number
  name: string | null
  email: string | null
}

describe('Personnes invitées', () => {
  let baseUrl = ''
  let close: () => void
  let adult = ''
  let teen = ''
  const db = openDatabase(':memory:')
  const mail = new MailSettingsStore(db)
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
  const list = async () =>
    (await (await call('/codes/invitations', adult)).json()) as { mail: boolean; invitations: Invitation[] }
  const check = async (code: string) => (await call('/codes/check', '', 'POST', { code })).status
  // The e-mail leaves after the answer.
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))

  before(async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 9),
      webDir,
      sourcesFile: 'unused.yml',
      databaseFile: ':memory:',
      backupDir: 'unused-backups',
      timeZone: 'UTC',
      vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
    }
    const catalog = parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n')
    const profiles = new ProfileStore(db)
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles,
      install: new InstallStore(db),
      accounts: new UserAccountStore(db),
      devices: new UserDeviceStore(db),
      codes: new SignInCodeStore(db, config.sessionSecret),
      serverMail: {
        store: mail,
        send: async (_settings, message) => {
          sent.push(message)
        }
      }
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
    adult = `${cookiesFrom(account)}; ${cookiesFrom(done)}`
    const leo = profiles.create('Léo', 'sport', Date.now(), { kind: 'teen' })!
    const opened = await call('/profiles/current', adult, 'PUT', { id: leo.id })
    teen = `${cookiesFrom(account)}; ${cookiesFrom(opened)}`
  })

  after(() => close())

  it('lists an invitation under its name, without sending anything while Serveur › E-mail is not set', async () => {
    const made = await call('/codes', adult, 'POST', { name: '  Mamie   Jo ', email: 'jo@example.com' })
    assert.equal(made.status, 201)
    const { code, sent: mailed } = (await made.json()) as { code: string; sent: boolean }
    assert.equal(mailed, false)
    assert.equal(await check(code), 200)
    const { mail: canMail, invitations } = await list()
    assert.equal(canMail, false)
    assert.deepEqual(
      invitations.map(({ name, email }) => ({ name, email })),
      [{ name: 'Mamie Jo', email: 'jo@example.com' }]
    )
  })

  it('refuses a name too long, an empty one or a wrong address', async () => {
    for (const body of [{ name: 'x'.repeat(41) }, { name: '  ' }, { name: 'Jo', email: 'pas une adresse' }])
      assert.equal((await call('/codes', adult, 'POST', body)).status, 400, JSON.stringify(body))
  })

  it('sends the code by e-mail once Serveur › E-mail is set, and again with a new code', async () => {
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
    const made = await call('/codes', adult, 'POST', { name: 'Paul', email: 'paul@example.com' })
    const first = (await made.json()) as { code: string; sent: boolean }
    assert.equal(first.sent, true)
    await settle()
    assert.equal(sent.at(-1)?.to, 'paul@example.com')
    assert.ok(sent.at(-1)?.text.includes(`#/code/${first.code}`))

    const paul = (await list()).invitations.find(invitation => invitation.name === 'Paul')!
    const renewed = await call(`/codes/invitations/${paul.id}/code`, adult, 'POST')
    assert.equal(renewed.status, 201)
    const second = (await renewed.json()) as { code: string; sent: boolean }
    assert.equal(second.sent, true)
    await settle()
    assert.ok(sent.at(-1)?.text.includes(`#/code/${second.code}`))
    // The first code works no more; the invitation stays, once, under its name.
    assert.equal(await check(first.code), 403)
    assert.equal(await check(second.code), 200)
    assert.equal((await list()).invitations.filter(invitation => invitation.name === 'Paul').length, 1)
  })

  it('sends a few e-mails a day at most, and still gives the code past them', async () => {
    const results: boolean[] = []
    for (let index = 0; index < INVITATION_MAILS_PER_DAY; index++) {
      const made = await call('/codes', adult, 'POST', { name: `Ami ${index}`, email: `ami${index}@example.com` })
      assert.equal(made.status, 201)
      const { code, sent: mailed } = (await made.json()) as { code: string; sent: boolean }
      assert.match(code, /^[A-Z2-9]{8}$/)
      results.push(mailed)
    }
    // The test before sent two: the last ones of the day go by hand.
    assert.deepEqual(results.slice(-2), [false, false])
    assert.ok(results.slice(0, -2).every(Boolean))
  })

  it('cancels an invitation: its code works no more', async () => {
    const made = (await (await call('/codes', adult, 'POST', { name: 'Zoé' })).json()) as { code: string }
    const zoe = (await list()).invitations.find(invitation => invitation.name === 'Zoé')!
    assert.equal(zoe.email, null)
    assert.equal((await call(`/codes/invitations/${zoe.id}`, adult, 'DELETE')).status, 204)
    assert.equal(await check(made.code), 403)
    assert.equal((await call(`/codes/invitations/${zoe.id}`, adult, 'DELETE')).status, 404)
    assert.equal((await call(`/codes/invitations/${zoe.id}/code`, adult, 'POST')).status, 404)
  })

  it('is for adults only', async () => {
    assert.equal((await call('/codes/invitations', teen)).status, 403)
    assert.equal((await call('/codes/invitations', '')).status, 401)
  })
})

describe('Personnes invitées, each adult their own', () => {
  it('lists, cancels and renews only the invitations this profile made', () => {
    const db = openDatabase(':memory:')
    const codes = new SignInCodeStore(db, Buffer.alloc(32, 9))
    const now = Date.now()
    const other = new ProfileStore(db).create('Paul', 'world', now)!.id
    codes.create({ createdBy: 1, invite: { name: 'Mamie', email: null } }, now)
    codes.create({ createdBy: other, invite: { name: 'Tonton', email: null } }, now)
    assert.deepEqual(
      codes.invitations(now, 1).map(invitation => invitation.name),
      ['Mamie']
    )
    const tonton = codes.invitations(now, other)[0]!
    assert.equal(codes.cancelInvitation(tonton.id, 1), false)
    assert.equal(codes.renewInvitation(tonton.id, 1, now), null)
    assert.equal(codes.cancelInvitation(tonton.id, other), true)
  })
})
