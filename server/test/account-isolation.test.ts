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
import { InstallStore } from '../db/install-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { UserStore } from '../db/user-store.ts'
import { YouthStore } from '../db/youth-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

const PASSWORD = 'une phrase de passe assez longue'
const DUPONT = 'claire@example.com'
const MARTIN = 'marc@example.com'

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

// One server, no household: the Duponts and the Martins are accounts side by side, and nothing the Martins do reaches
// the Duponts, or the other way round.
describe('two families on one server', () => {
  const db = openDatabase(':memory:')
  let baseUrl = ''
  let close = () => {}
  let dupont = ''
  let martin = ''
  let martinAdmin = 0
  let martinTeen = 0
  let dupontAdmin = 0

  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  const json = async <T>(url: string, cookie: string) => (await (await call(url, cookie)).json()) as T
  const profileIds = async (cookie: string) =>
    (await json<{ profiles: { id: number }[] }>('/profiles', cookie)).profiles.map(profile => profile.id)

  before(async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'hodi-web-'))
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Hodi</title>')
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      sessionSecret: Buffer.alloc(32, 7),
      webDir,
      sourcesFile: 'unused.yml',
      databaseFile: ':memory:',
      backupDir: 'unused-backups',
      timeZone: 'UTC',
      vapid: { publicKey: 'unused', privateKey: 'unused', subject: 'mailto:test@example.com' }
    }
    const catalog = parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n')
    const accounts = new UserAccountStore(db)
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles: new ProfileStore(db),
      install: new InstallStore(db),
      accounts,
      devices: new UserDeviceStore(db),
      codes: new SignInCodeStore(db, config.sessionSecret),
      users: id => new UserStore(db, id),
      youth: new YouthStore(db, () => 'UTC'),
      sources: { store: new SourceStore(db), file: catalog, find: async () => ({ status: 'none' }) }
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()

    // The Duponts: the core's own household, made by the setup, which names it no more.
    const account = await call('/setup/account', '', 'POST', { email: DUPONT, password: PASSWORD })
    const done = await call('/setup', cookiesFrom(account), 'POST', {
      profile: { name: 'Claire', color: 'tech' },
      timeZone: 'Europe/Brussels',
      ai: null
    })
    assert.equal(done.status, 200)
    dupont = `${cookiesFrom(account)}; ${cookiesFrom(done)}`
    dupontAdmin = (await profileIds(dupont))[0]!

    // The Martins: Marc with his account, and his teen.
    const now = Date.now()
    const martins = new ProfileStore(db)
    const marc = martins.create('Marc', 'world', now)!
    martinAdmin = marc.id
    martinTeen = martins.create('Léo', 'sport', now, { kind: 'teen' })!.id
    const user = accounts.create(MARTIN, await hashPassword(PASSWORD), now)!
    accounts.linkProfile(user.id, marc.id)
    // Every teen has an account of their own, made by a parent.
    const leo = accounts.create('leo@example.com', 'hash', now)!
    accounts.linkProfile(leo.id, martinTeen)
    db.prepare('INSERT INTO account_parents (child_id, parent_id, created_at) VALUES (?, ?, ?)').run(
      leo.id,
      user.id,
      now
    )

    const login = await call('/login', '', 'POST', { email: MARTIN, password: PASSWORD })
    assert.equal(login.status, 204)
    martin = cookiesFrom(login)
  })

  after(() => close())

  it('shows each account its own profiles only', async () => {
    assert.deepEqual(await profileIds(martin), [martinAdmin, martinTeen])
    assert.ok(!(await profileIds(dupont)).includes(martinAdmin))
    const session = await json<{ profileChosen: boolean }>('/session', martin)
    assert.equal(session.profileChosen, true)
  })

  it('never opens or changes a profile of the other account', async () => {
    // « Qui lit ? » with a profile of the Duponts: not one of the Martins'.
    assert.equal((await call('/profiles/current', martin, 'PUT', { id: dupontAdmin })).status, 400)
    assert.equal((await call('/profiles/current', dupont, 'PUT', { id: martinTeen })).status, 400)
    assert.equal((await call(`/profiles/${dupontAdmin}`, martin, 'PATCH', { name: 'Volé' })).status, 404)
    assert.equal((await call(`/profiles/${dupontAdmin}`, martin, 'DELETE', { password: PASSWORD })).status, 404)
    const names = (await json<{ profiles: { name: string }[] }>('/profiles', dupont)).profiles.map(p => p.name)
    assert.deepEqual(names, ['Claire'])
  })

  it("shows another account's photo only to those it shared with", async () => {
    // Zoé, another adult of the server with her own account, never signed in on Claire's device.
    const profiles = new ProfileStore(db)
    const zoe = profiles.create('Zoé', 'music', Date.now())!
    const accounts = new UserAccountStore(db)
    accounts.linkProfile(accounts.create('zoe@example.com', 'hash', Date.now())!.id, zoe.id)
    profiles.setPhoto(zoe.id, { data: Buffer.from('photo'), type: 'image/webp' }, Date.now())
    // Ids follow each other: without a tie, nobody goes through every adult's photo.
    assert.equal((await call(`/profiles/${zoe.id}/photo`, dupont)).status, 404)
    new UserStore(db, zoe.id).shareTo(dupontAdmin, { id: 'a' }, Date.now())
    assert.equal((await call(`/profiles/${zoe.id}/photo`, dupont)).status, 200)
    profiles.delete(zoe.id)
  })

  // Claire made the server, so she is its admin: never a way into the Martins' profiles or their teen's rules.
  it("gives the server's admin no hold on another account's profiles or children", async () => {
    assert.equal((await json<{ serverAdmin: boolean }>('/profiles', dupont)).serverAdmin, true)
    assert.equal((await call(`/profiles/${martinTeen}`, dupont, 'DELETE', { password: PASSWORD })).status, 404)
    assert.equal((await call(`/profiles/${martinAdmin}`, dupont, 'DELETE', { password: PASSWORD })).status, 404)
    assert.equal((await call(`/profiles/${martinTeen}/rules`, dupont)).status, 404)
    assert.equal((await call(`/profiles/${martinTeen}/rules`, dupont, 'PUT', { dailyMinutes: 10 })).status, 404)
    assert.deepEqual(await profileIds(martin), [martinAdmin, martinTeen])
    // Marc, their parent, still reaches them.
    assert.equal((await call(`/profiles/${martinTeen}/rules`, martin)).status, 200)
  })

  it('shares only with the accounts one is tied to', async () => {
    const targets = async (cookie: string) =>
      (await json<{ people: { id: number }[] }>('/me/share-targets', cookie)).people.map(person => person.id)
    assert.deepEqual(await targets(martin), [martinTeen])
    assert.deepEqual(await targets(dupont), [])
  })

  // Every screen Marc opens, signed in on his own device: nothing of Claire's in any answer, nothing of /server.
  it("shows Marc nothing of Claire's on any screen", async () => {
    const screens = [
      ...['/session', '/profiles', '/account', '/account/children', '/ai-usage', '/ai-usage/plugins', '/game'],
      ...['/me/game', '/me/history', '/me/share-senders', '/me/share-targets', '/me/shares', '/me/source-requests'],
      ...['/me/time', '/me/limits', '/me/resume', '/sources', '/source-requests', '/storage', '/topics', '/plugins']
    ]
    for (const screen of screens) {
      const answer = await call(screen, martin)
      assert.ok(answer.status < 500, `${screen}: ${answer.status}`)
      const text = await answer.text()
      assert.doesNotMatch(text, /Claire|claire@example\.com/, screen)
      assert.doesNotMatch(text, new RegExp(`"(id|profileId)":${dupontAdmin}[,}]`), screen)
    }
    for (const screen of ['/server/accounts', '/server/overview', '/server/general', '/server/inbox']) {
      const refused = await call(screen, martin)
      assert.ok(refused.status >= 400 && refused.status < 500, `${screen}: ${refused.status}`)
    }
  })

  // Each parent sees the requests of their own teens in Demandes, never another family's.
  it("shows each parent only their own teens' source requests", async () => {
    const now = Date.now()
    const accounts = new UserAccountStore(db)
    const profiles = new ProfileStore(db)
    const youth = new YouthStore(db, () => 'UTC')
    const claire = accounts.byEmail(DUPONT)!
    const lina = profiles.create('Lina', 'music', now, { kind: 'teen' })!
    accounts.linkProfile(accounts.create('lina@example.com', 'hash', now)!.id, lina.id)
    db.prepare('INSERT INTO account_parents (child_id, parent_id, created_at) VALUES (?, ?, ?)').run(
      accounts.ofProfile(lina.id)!.id,
      claire.id,
      now
    )
    const source = (name: string) => ({ id: '', name, url: `https://${name}.example/feed`, kind: 'article' as const })
    const linas = youth.addRequest(lina.id, { ...source('lina'), lang: 'fr', domains: [], skip: [] }, now)
    const leos = youth.addRequest(martinTeen, { ...source('leo'), lang: 'fr', domains: [], skip: [] }, now)
    try {
      await checkRequests(linas.id, leos.id)
    } finally {
      youth.decide(linas.id, 'refused', now)
      youth.decide(leos.id, 'refused', now)
      profiles.delete(lina.id)
    }
  })

  const checkRequests = async (linas: number, leos: number) => {
    const asked = async (cookie: string) =>
      (await json<{ requests: { id: number }[] }>('/source-requests', cookie)).requests.map(entry => entry.id)
    assert.deepEqual(await asked(dupont), [linas])
    assert.deepEqual(await asked(martin), [leos])
    // Nor can Claire answer Léo's.
    assert.equal((await call(`/source-requests/${leos}`, dupont, 'POST', { accept: false })).status, 404)
  }

  // A code no longer opens a household: whoever made it, the new account gets its own profile on the server.
  it('makes an account of its own with any adult’s code', async () => {
    const made = await call('/codes', martin, 'POST', {})
    assert.equal(made.status, 201)
    const { code } = (await made.json()) as { code: string }
    const joined = await call('/codes/join', '', 'POST', {
      code,
      email: 'julie@example.com',
      password: PASSWORD,
      ageConfirmed: true,
      profile: { name: 'Julie', color: 'world' }
    })
    assert.equal(joined.status, 200)
    const julie = cookiesFrom(joined)
    // Julie reads with her own profile: nobody else's is on her device.
    const ids = await profileIds(julie)
    assert.equal(ids.length, 1)
    assert.ok(!ids.includes(martinAdmin))
    assert.deepEqual(
      (await json<{ profiles: { name: string }[] }>('/profiles', dupont)).profiles.map(p => p.name),
      ['Claire']
    )
  })

  it("refuses the Duponts' code to Marc, who already reads with his own profile", async () => {
    const made = await call('/codes', dupont, 'POST', {})
    const { code } = (await made.json()) as { code: string }
    const joined = await call('/codes/join', '', 'POST', {
      code,
      email: MARTIN,
      password: PASSWORD,
      ageConfirmed: true,
      profile: { name: 'Marc', color: 'world' }
    })
    assert.equal(joined.status, 409)
    assert.deepEqual(await joined.json(), { error: 'email_taken' })
    assert.equal(joined.headers.getSetCookie().length, 0)
    assert.deepEqual(
      (await json<{ profiles: { name: string }[] }>('/profiles', dupont)).profiles.map(p => p.name),
      ['Claire']
    )
  })

  it('adds Marc to a device of the Duponts, where each reads with their own profiles only', async () => {
    const added = await call('/login', dupont, 'POST', { email: MARTIN, password: PASSWORD })
    assert.equal(added.status, 204)
    // The new session cookie holds both accounts: it takes the place of the device's.
    const fresh = cookiesFrom(added).split('; ')
    const names = new Set(fresh.map(part => part.split('=')[0]))
    const both = [...dupont.split('; ').filter(part => !names.has(part.split('=')[0])), ...fresh].join('; ')
    // Qui lit ? on that device: Claire's, Marc's and his teen's, as both accounts are signed in there.
    assert.deepEqual((await profileIds(both)).sort(), [dupontAdmin, martinAdmin, martinTeen].sort())
    // Claire's own device, without Marc, still shows Claire only.
    assert.deepEqual(await profileIds(dupont), [dupontAdmin])
  })
})
