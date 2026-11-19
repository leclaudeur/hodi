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
import { ProfileStore } from '../db/profile-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { UserStore } from '../db/user-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { followEveryBase } from '../start/every-base.ts'
import { isLanguage } from '../../shared/i18n.ts'
import { fakeFetch } from './helpers/news.ts'

const PASSWORD = 'une phrase de passe assez longue'

// One French base source, one English one, and one that is no base source at all.
const FILE = parseCatalog(`
topics:
  - id: world
    label: Monde
    sources:
      - id: rfi
        name: RFI
        url: https://rfi.example/feed
        domains: [rfi.example]
        base: [fr]
      - id: bbc
        name: BBC
        url: https://bbc.example/feed
        domains: [bbc.example]
        lang: en
        base: [en]
      - id: other
        name: Other
        url: https://other.example/feed
        domains: [other.example]
`)

const cookiesFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .join('; ')

// A fresh install whose admin's account is made, its household not set up yet.
const startInstall = async () => {
  const db = openDatabase(':memory:')
  const household = new HouseholdStore(db)
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
  const users = (id: number) => new UserStore(db, id)
  const sources = new SourceStore(db)
  const news = new NewsService(sources.load(FILE, Date.now(), null), {
    fetchText: fakeFetch({}).fetchText,
    log: () => {},
    // As the app does: the profile's language, else the household's.
    languageOf: id => {
      const own = users(id).preferences()?.language
      return isLanguage(own) ? own : household.get().language
    }
  })
  const server = createApp(config, {
    news,
    profiles: new ProfileStore(db),
    household,
    accounts: new UserAccountStore(db),
    devices: new UserDeviceStore(db),
    codes: new SignInCodeStore(db, config.sessionSecret),
    users,
    sources: { store: sources, file: FILE, find: async () => ({ status: 'none' }) }
  }).listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (url: string, cookie: string, method = 'GET', body?: unknown) =>
    fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  return { db, call, users, close: () => server.close() }
}

describe('base sources in every language', () => {
  let install: Awaited<ReturnType<typeof startInstall>>
  let admin = ''
  let adminId = 0

  before(async () => {
    install = await startInstall()
    const account = await install.call('/setup/account', '', 'POST', { email: 'admin@example.com', password: PASSWORD })
    assert.equal(account.status, 204)
    const setUp = await install.call('/setup', cookiesFrom(account), 'POST', {
      name: 'Foyer',
      profile: { name: 'Alex', color: 'world' },
      language: 'fr'
    })
    assert.equal(setUp.status, 200)
    adminId = ((await setUp.json()) as { profileId: number }).profileId
    admin = `${cookiesFrom(account)}; ${cookiesFrom(setUp)}`
  })

  after(() => install.close())

  it('follows both languages, the other one off for the admin set up in French', async () => {
    const listed = (await (await install.call('/sources', admin)).json()) as { sources: { id: string }[] }
    assert.deepEqual(listed.sources.map(source => source.id).sort(), ['bbc', 'rfi'])
    assert.deepEqual(install.users(adminId).hiddenSources(), ['bbc'])
  })

  it('starts a person who joins in English with the English base sources', async () => {
    const made = await install.call('/codes', admin, 'POST', {})
    assert.equal(made.status, 201)
    const { code } = (await made.json()) as { code: string }
    const joined = await install.call('/codes/join', '', 'POST', {
      code,
      email: 'sam@example.com',
      password: PASSWORD,
      ageConfirmed: true,
      profile: { name: 'Sam', color: 'ai' },
      language: 'en'
    })
    assert.equal(joined.status, 200)
    const { profileId } = (await joined.json()) as { profileId: number }
    assert.equal(install.users(profileId).preferences()?.language, 'en')
    assert.deepEqual(install.users(profileId).hiddenSources(), ['rfi'])
  })

  it('starts a young profile in the language of the parent who made it', async () => {
    // The admin reads in English now (Mon compte).
    install.users(adminId).setPreferences({ language: 'en' }, Date.now())
    const made = await install.call('/profiles', admin, 'POST', { name: 'Léa', color: 'world', kind: 'teen' })
    assert.equal(made.status, 201)
    const { id } = (await made.json()) as { id: number }
    assert.equal(install.users(id).preferences()?.language, 'en')
    assert.ok(install.users(id).hiddenSources().includes('rfi'))
  })
})

describe('a household set up before every language came in', () => {
  it('follows the other language once, off for the profiles that read in another one', () => {
    const db = openDatabase(':memory:')
    const household = new HouseholdStore(db)
    household.setUp({ name: 'Foyer', timeZone: null, country: null, language: 'fr', ai: null }, 1)
    const profiles = new ProfileStore(db)
    const english = profiles.create('Sam', 'ai', 1)!
    new UserStore(db, english.id).setPreferences({ language: 'en' }, 1)
    const sources = new SourceStore(db)
    const frenchOnly = parseCatalog(`
topics:
  - id: world
    label: Monde
    sources:
      - id: rfi
        name: RFI
        url: https://rfi.example/feed
        domains: [rfi.example]
        base: [fr]
`)
    sources.load(frenchOnly, 1, 'fr')
    // Its own French base source removed by the admin: it stays gone.
    sources.remove('rfi')
    // As before every language: the catalogue filled, the other languages not in yet.
    db.prepare("DELETE FROM seeds WHERE name = 'every-base'").run()

    followEveryBase(db, { sources, file: FILE, household, profiles }, 2)
    assert.deepEqual(
      sources.load(FILE, 2, 'fr').topics[0]?.sources.map(source => source.id),
      ['bbc']
    )
    const french = profiles.list().find(profile => profile.id !== english.id)!
    assert.deepEqual(new UserStore(db, french.id).hiddenSources(), ['bbc'])
    assert.deepEqual(new UserStore(db, english.id).hiddenSources(), [])

    // Once only: a source the household removes afterwards does not come back.
    sources.remove('bbc')
    followEveryBase(db, { sources, file: FILE, household, profiles }, 3)
    assert.equal(sources.has('bbc'), false)
  })
})
