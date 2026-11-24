import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { cleanHandle, handleFrom } from '../handle.ts'
import { createApp } from '../app.ts'
import type { Config } from '../config.ts'
import { AccountDataStore } from '../db/account-data.ts'
import { openDatabase } from '../db/database.ts'
import { HandleStore } from '../db/handle-store.ts'
import { InstallStore } from '../db/install-store.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserDeviceStore } from '../db/user-device-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

// Every account's @identifier: unique on the server, suggested from a name, typed to sign in, changed once a month.

const PASSWORD = 'une phrase de passe assez longue'
const NOW = Date.UTC(2026, 10, 20, 9)
const DAY = 24 * 60 * 60 * 1000

describe('an identifier', () => {
  it('holds lower-case letters, digits, a dot or an underscore, 3 to 20 of them', () => {
    assert.equal(cleanHandle(' @Anthony.D '), 'anthony.d')
    assert.equal(cleanHandle('le_lecteur_42'), 'le_lecteur_42')
    for (const wrong of ['an', 'x'.repeat(21), 'jo-jo', 'zoé', 'a b', 'ça@va', 42])
      assert.equal(cleanHandle(wrong), null)
    assert.equal(handleFrom('Zoé Dupont-Lévy'), 'zoedupontlevy')
  })

  it('is suggested from a name, with the first number that makes it free', () => {
    const db = openDatabase(':memory:')
    const accounts = new UserAccountStore(db)
    const handles = new HandleStore(db)
    assert.equal(accounts.create('anthony@example.com', 'hash', NOW)!.handle, 'anthony')
    assert.equal(accounts.create('anthony@example.org', 'hash', NOW)!.handle, 'anthony2')
    assert.equal(accounts.create('al@example.com', 'hash', NOW)!.handle, 'al_')
    assert.equal(handles.suggest('Anthony', NOW), 'anthony3')
    assert.equal(accounts.create('sam@example.com', 'hash', NOW, { handle: 'le.sam' })!.handle, 'le.sam')
  })

  it('is given at startup to the accounts made before identifiers, from their profile’s name', () => {
    const db = openDatabase(':memory:')
    const accounts = new UserAccountStore(db)
    const profiles = new ProfileStore(db)
    const lea = accounts.create('l.martin@example.com', 'hash', NOW)!
    accounts.linkProfile(lea.id, profiles.create('Léa', 'world', NOW)!.id)
    const other = accounts.create('other@example.com', 'hash', NOW)!
    db.prepare('UPDATE users SET handle = NULL').run()
    new HandleStore(db).fillMissing(NOW)
    assert.equal(accounts.get(lea.id)!.handle, 'lea')
    assert.equal(accounts.get(other.id)!.handle, 'other')
  })

  it('changes once every 30 days, and the one left stays its account’s for 30 days', () => {
    const db = openDatabase(':memory:')
    const accounts = new UserAccountStore(db)
    const handles = new HandleStore(db)
    const zoe = accounts.create('zoe@example.com', 'hash', NOW)!
    const sam = accounts.create('sam@example.com', 'hash', NOW)!
    assert.equal(handles.change(zoe.id, 'sam', NOW), 'taken')
    assert.equal(handles.change(zoe.id, 'zozo', NOW), 'changed')
    assert.equal(handles.changeableFrom(zoe.id, NOW), NOW + 30 * DAY)
    assert.equal(handles.change(zoe.id, 'zoe.d', NOW + DAY), 'too_soon')
    assert.equal(handles.isFree('zoe', NOW + DAY), false)
    assert.equal(handles.isFree('zoe', NOW + DAY, zoe.id), true)
    assert.equal(handles.change(sam.id, 'zoe', NOW + DAY), 'taken')
    assert.equal(handles.change(sam.id, 'zoe', NOW + 31 * DAY), 'changed')
    assert.equal(handles.change(zoe.id, 'zoe.d', NOW + 31 * DAY), 'changed')
    assert.equal(handles.changeableFrom(sam.id, NOW + 61 * DAY), null)
  })
})

describe('identifiers through the API', () => {
  let baseUrl = ''
  let close: () => void
  let claire = ''
  const db = openDatabase(':memory:')

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
  const checkCall = (handle: string, cookie: string, code?: string) =>
    call('/handles/check', cookie, 'POST', { handle, code })
  const check = async (handle: string, cookie = claire, code?: string) =>
    (await (await checkCall(handle, cookie, code)).json()) as {
      free: boolean
      suggestion: string | null
    }

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
    const server = createApp(config, {
      news: new NewsService(catalog, { fetchText: fakeFetch({}).fetchText, log: () => {} }),
      profiles: new ProfileStore(db),
      install: new InstallStore(db),
      accounts: new UserAccountStore(db),
      handles: new HandleStore(db),
      accountData: new AccountDataStore(db),
      devices: new UserDeviceStore(db),
      codes: new SignInCodeStore(db, config.sessionSecret)
    }).listen(0)
    await new Promise(resolve => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()

    const account = await call('/setup/account', '', 'POST', { email: 'claire@example.com', password: PASSWORD })
    // The setup's own account: its identifier from the e-mail is its own.
    assert.equal((await check('claire', cookiesFrom(account))).free, true)
    const done = await call('/setup', cookiesFrom(account), 'POST', {
      name: 'Famille Dupont',
      profile: { name: 'Claire', color: 'tech', handle: '@Claire.D' },
      timeZone: 'Europe/Brussels',
      ai: null
    })
    assert.equal(done.status, 200)
    claire = `${cookiesFrom(account)}; ${cookiesFrom(done)}`
  })

  after(() => close())

  it('keeps the one chosen in the first-run screens, and signs in with it', async () => {
    assert.equal(((await (await call('/account', claire)).json()) as { handle: string }).handle, 'claire.d')
    assert.equal((await call('/login', '', 'POST', { email: '@claire.d', password: PASSWORD })).status, 204)
    assert.equal((await call('/login', '', 'POST', { email: 'Claire.D', password: PASSWORD })).status, 204)
    assert.equal((await call('/login', '', 'POST', { email: 'claire.d', password: 'wrong password' })).status, 401)
    assert.equal((await call('/login', '', 'POST', { email: 'x', password: PASSWORD })).status, 400)
  })

  it('says whether one is free, and a free one like it when not', async () => {
    const code = ((await (await call('/codes', claire, 'POST', {})).json()) as { code: string }).code
    assert.deepEqual(await check('claire.d', '', code), { free: false, suggestion: 'claire.d2' })
    assert.deepEqual(await check('claire.d'), { free: true, suggestion: null })
    assert.deepEqual(await check('paul', '', code), { free: true, suggestion: null })
    assert.equal((await checkCall('a', claire)).status, 400)
  })

  it('answers no one signed out without an invitation, so identifiers cannot be listed', async () => {
    assert.equal((await checkCall('claire.d', '')).status, 401)
    assert.equal((await checkCall('claire.d', '', 'ABCDEFGH')).status, 401)
  })

  it('makes a code’s new account with the one it typed, unless taken', async () => {
    const codeOf = async () => ((await (await call('/codes', claire, 'POST', {})).json()) as { code: string }).code
    const join = async (handle: string) =>
      call('/codes/join', '', 'POST', {
        code: await codeOf(),
        email: `${handle.replace(/\W/g, '')}@example.com`,
        password: PASSWORD,
        ageConfirmed: true,
        profile: { name: 'Paul', color: 'world', handle }
      })
    assert.equal((await join('claire.d')).status, 409)
    assert.equal((await join('pa')).status, 400)
    const joined = await join('paul_')
    assert.equal(joined.status, 200)
    const paul = cookiesFrom(joined)
    assert.equal(((await (await call('/account', paul)).json()) as { handle: string }).handle, 'paul_')
  })

  it('changes in Mon compte once every 30 days', async () => {
    assert.equal((await call('/account/handle', '', 'PUT', { handle: 'claire' })).status, 401)
    assert.equal((await call('/account/handle', claire, 'PUT', { handle: 'paul_' })).status, 409)
    assert.equal((await call('/account/handle', claire, 'PUT', { handle: 'c' })).status, 400)
    const changed = await call('/account/handle', claire, 'PUT', { handle: 'claire' })
    assert.equal(changed.status, 200)
    const { changeableFrom } = (await changed.json()) as { changeableFrom: number }
    assert.ok(changeableFrom > Date.now() + 29 * DAY)
    const again = await call('/account/handle', claire, 'PUT', { handle: 'claire.dupont' })
    assert.equal(again.status, 409)
    assert.equal(((await again.json()) as { error: string }).error, 'too_soon')
    const view = (await (await call('/account', claire)).json()) as { handle: string; handleChangeableFrom: number }
    assert.equal(view.handle, 'claire')
    assert.equal(view.handleChangeableFrom, changeableFrom)
  })
})
