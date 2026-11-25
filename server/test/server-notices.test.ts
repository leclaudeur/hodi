import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import express from 'express'
import { type TestPlugin, testPlugin } from '../../plugin-sdk/testing.ts'
import { openDatabase } from '../db/database.ts'
import type { MailSettings } from '../db/mail-settings-store.ts'
import { ServerNoticeStore } from '../db/server-notice-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { serverNoticeRoutes } from '../http/server-notice-routes.ts'
import type { MailMessage } from '../mail/mailer.ts'
import type { AlertPayload, PushTarget } from '../news/followed-alerts.ts'
import { type ServerNoticeIn, serverNotifier } from '../notices/server-notifier.ts'
import { parseManifest } from '../plugins/manifest.ts'
import { SERVER_NOTICES_PER_DAY, pluginServerNotice, pluginServerNotifier } from '../plugins/server-notify.ts'
import { PLUGIN_SDK } from '../plugins/plugin-sdk.ts'

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
const PHONE: PushTarget = { endpoint: 'https://fcm.googleapis.com/fcm/send/phone', keys: { p256dh: 'p', auth: 'a' } }
const LAPTOP: PushTarget = { endpoint: 'https://web.push.apple.com/laptop', keys: { p256dh: 'q', auth: 'b' } }
const KINDS = [
  { type: 'household', label: 'Nouveau foyer', hint: 'Quand quelqu’un crée un foyer' },
  { type: 'waitlist', label: 'Nouvelle inscription', hint: null }
]

// The server's admin (account 1), with a second account that is not one.
const serverWith = () => {
  const db = openDatabase(':memory:')
  const accounts = new UserAccountStore(db)
  const admin = accounts.createServerAdmin('admin@example.test', 'hash', 0)!
  const other = accounts.create('lea@example.test', 'hash', 0)!
  return { db, accounts, admin, other, store: new ServerNoticeStore(db) }
}

const notifierOn = (server: ReturnType<typeof serverWith>, mail: MailSettings | null = MAIL) => {
  const mails: MailMessage[] = []
  const pushed: { target: PushTarget; payload: AlertPayload }[] = []
  const gone = new Set<string>()
  const notifier = serverNotifier({
    store: server.store,
    admins: () => server.accounts.serverAdmins(),
    mail: { settings: () => mail, send: async (_settings, message) => void mails.push(message) },
    push: async (target, payload) => {
      if (gone.has(target.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 })
      pushed.push({ target, payload })
    },
    languageOf: () => 'fr',
    log: () => {}
  })
  return { notifier, mails, pushed, gone }
}

const TYPE = 'plugin:village:household'
const NOTICE = {
  from: 'Village',
  title: 'Nouveau foyer',
  text: 'La famille Dupont vient de créer son foyer.',
  url: '#/server/plugin/village/households'
}

describe('server notices', () => {
  it('reads the kinds a plugin declares, and refuses them without permissions.notify', () => {
    const base = {
      id: 'village',
      name: 'Village',
      version: '1.0.0',
      description: 'Des foyers.',
      api: 2,
      sdk: PLUGIN_SDK
    }
    const manifest = parseManifest({
      ...base,
      permissions: { notify: true },
      serverNotifications: [{ type: 'household', label: ' Nouveau foyer ', hint: 'Quand quelqu’un crée un foyer' }]
    })
    assert.deepEqual(manifest.serverNotifications, [
      { type: 'household', label: 'Nouveau foyer', hint: 'Quand quelqu’un crée un foyer' }
    ])
    assert.deepEqual(parseManifest(base).serverNotifications, [])
    const refused = [
      { serverNotifications: [{ type: 'household', label: 'Nouveau foyer' }] },
      { permissions: { notify: true }, serverNotifications: [{ type: 'Household', label: 'a' }] },
      { permissions: { notify: true }, serverNotifications: [{ type: 'a', label: '' }] },
      { permissions: { notify: true }, serverNotifications: [{ type: 'a', label: 'x'.repeat(61) }] },
      { permissions: { notify: true }, serverNotifications: [{ type: 'a', label: 'a', hint: 'x'.repeat(81) }] },
      {
        permissions: { notify: true },
        serverNotifications: [
          { type: 'a', label: 'a' },
          { type: 'a', label: 'b' }
        ]
      },
      { permissions: { notify: true }, serverNotifications: 'household' }
    ]
    for (const extra of refused) assert.throws(() => parseManifest({ ...base, ...extra }), JSON.stringify(extra))
  })

  it('comes by e-mail until the admin chooses, and keeps each account’s choices and devices apart', () => {
    const { store, admin, other } = serverWith()
    assert.deepEqual(store.choice(admin.id, TYPE), { email: true, push: false })
    store.choose(admin.id, TYPE, { email: false, push: true })
    assert.deepEqual(store.choice(admin.id, TYPE), { email: false, push: true })
    assert.deepEqual(store.choice(other.id, TYPE), { email: true, push: false })

    store.addDevice(admin.id, PHONE, 1)
    store.addDevice(other.id, LAPTOP, 2)
    // Another account cannot take the admin's device off.
    store.removeDevice(PHONE.endpoint, other.id)
    assert.deepEqual(store.devices(admin.id), [PHONE])
    // Ten devices at most: the one not heard from for longest goes.
    for (let index = 0; index < 10; index++) {
      store.addDevice(admin.id, { ...PHONE, endpoint: `https://fcm.googleapis.com/fcm/send/${index}` }, 10 + index)
    }
    assert.equal(store.devices(admin.id).length, 10)
    assert.ok(!store.devices(admin.id).some(device => device.endpoint === PHONE.endpoint))
  })

  it('tells each server admin as they chose, in the e-mail template and in push', async () => {
    const server = serverWith()
    const { notifier, mails, pushed, gone } = notifierOn(server)
    // Léa is no server admin: she is never told.
    server.store.choose(server.other.id, TYPE, { email: true, push: true })

    assert.deepEqual(await notifier.tell(TYPE, NOTICE), { emails: 1, pushes: 0 })
    assert.equal(mails[0]?.to, 'admin@example.test')
    assert.equal(mails[0]?.subject, 'Village · Nouveau foyer')
    assert.match(mails[0]?.html ?? '', /href="https:\/\/hodi\.example\.test\/#\/server\/plugin\/village\/households"/)
    assert.match(mails[0]?.text ?? '', /La famille Dupont vient de créer son foyer\.\n\nOuvrir dans Hodi :/)
    assert.match(mails[0]?.text ?? '', /Choisis ce qu’il te signale dans Serveur › Alertes\./)

    server.store.choose(server.admin.id, TYPE, { email: false, push: true })
    server.store.addDevice(server.admin.id, PHONE, 1)
    server.store.addDevice(server.admin.id, LAPTOP, 2)
    gone.add(LAPTOP.endpoint)
    assert.deepEqual(await notifier.tell(TYPE, NOTICE), { emails: 0, pushes: 1 })
    assert.deepEqual(pushed, [
      {
        target: PHONE,
        payload: {
          title: 'Village · Nouveau foyer',
          body: 'La famille Dupont vient de créer son foyer.',
          url: '#/server/plugin/village/households',
          tag: 'server:plugin:village:household',
          badge: null
        }
      }
    ])
    // The browser dropped the laptop's subscription: it is forgotten.
    assert.deepEqual(server.store.devices(server.admin.id), [PHONE])
  })

  it('sends no e-mail while Serveur › E-mail is not set', async () => {
    const { notifier, mails } = notifierOn(serverWith(), null)
    assert.deepEqual(await notifier.tell(TYPE, NOTICE), { emails: 0, pushes: 0 })
    assert.equal(mails.length, 0)
  })

  it('takes a plugin’s kinds only, in short plain text, fifty a day', async () => {
    assert.deepEqual(pluginServerNotice({ title: ' Nouveau foyer ', text: 'Les Dupont.', path: 'households/4' }), {
      title: 'Nouveau foyer',
      text: 'Les Dupont.',
      path: 'households/4',
      important: null
    })
    const refused = [
      null,
      { title: 'a' },
      { title: 'a\nb', text: 'b' },
      { title: 'x'.repeat(81), text: 'b' },
      { title: 'a', text: 'x'.repeat(241) },
      { title: 'a', text: 'b', path: '../settings' },
      { title: 'a', text: 'b', to: 'someone@example.test' },
      { title: {}, text: 'b' },
      { title: { de: 'a' }, text: 'b' },
      { title: { fr: 'a', en: 'x'.repeat(81) }, text: 'b' }
    ]
    for (const value of refused) assert.equal(pluginServerNotice(value), null, JSON.stringify(value))

    const told: unknown[] = []
    const clock = { now: 0 }
    const notifier = pluginServerNotifier({
      // Each notice as a French admin reads it.
      notifier: {
        tell: async (type, notice) => (
          told.push({ type, ...(typeof notice === 'function' ? notice('fr') : notice) }),
          { emails: 1, pushes: 0 }
        )
      },
      now: () => clock.now,
      log: () => {}
    })
    const plugin = { id: 'village', name: 'Village', kinds: KINDS }
    await assert.rejects(notifier.send(plugin, 'accounts', { title: 'a', text: 'b' }), /unknown_type/)
    await assert.rejects(notifier.send(plugin, 'household', { title: 'a' }), /invalid_notice/)
    await notifier.send(plugin, 'household', { title: 'Nouveau foyer', text: 'Les Dupont.', path: 'households' })
    assert.deepEqual(told, [{ type: TYPE, ...NOTICE, text: 'Les Dupont.' }])
    // One text per language: each admin reads theirs, the French when theirs is missing.
    let written: ServerNoticeIn | null = null
    const languages = pluginServerNotifier({
      notifier: { tell: async (_type, notice) => ((written = notice), { emails: 1, pushes: 0 }) },
      log: () => {}
    })
    await languages.send(plugin, 'household', {
      title: { fr: 'Nouveau foyer', en: 'New household' },
      text: { fr: 'Les Dupont.' }
    })
    const inEnglish = (written as unknown as (language: 'fr' | 'en') => { title: string; text: string })('en')
    assert.deepEqual([inEnglish.title, inEnglish.text], ['New household', 'Les Dupont.'])
    for (let index = 1; index < SERVER_NOTICES_PER_DAY; index++) {
      await notifier.send(plugin, 'waitlist', { title: 'a', text: 'b' })
    }
    await assert.rejects(notifier.send(plugin, 'waitlist', { title: 'a', text: 'b' }), /too_many_notices/)
    clock.now += 24 * 60 * 60 * 1000
    await notifier.send(plugin, 'waitlist', { title: 'a', text: 'b' })
  })
})

describe('Serveur › Notifications routes', () => {
  const server = serverWith()
  const app = express()
  app.use(express.json())
  // The server admin asking, or account 0 for a request that has none.
  app.use((request, response, next) => {
    response.locals.asking = Number(request.headers['x-account'])
    next()
  })
  let mailReady = false
  app.use(
    '/notifications',
    serverNoticeRoutes({
      store: server.store,
      accountOf: response => (response.locals.asking as number) || null,
      coreKinds: [],
      plugins: () => [
        {
          id: 'village',
          name: 'Village',
          translations: { en: { name: 'Village', serverNotifications: { household: { label: 'New household' } } } },
          kinds: KINDS
        }
      ],
      mailReady: () => mailReady,
      publicKey: 'BKey',
      now: () => 5
    })
  )
  const listening = app.listen(0)
  after(() => listening.close())
  const call = (route: string, method = 'GET', body?: unknown, account = server.admin.id) =>
    fetch(`http://127.0.0.1:${(listening.address() as AddressInfo).port}/notifications${route}`, {
      method,
      headers: { 'x-account': String(account), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  it('lists the kinds with the admin’s choices, and saves them', async () => {
    assert.equal((await call('', 'GET', undefined, 0)).status, 403)
    const first = (await (await call('')).json()) as {
      mail: boolean
      publicKey: string
      kinds: { id: string; label: string; translations: unknown; email: boolean; push: boolean }[]
    }
    assert.equal(first.mail, false)
    assert.equal(first.publicKey, 'BKey')
    assert.deepEqual(
      first.kinds.map(kind => [kind.id, kind.label, kind.email, kind.push]),
      [
        ['plugin:village:household', 'Nouveau foyer', true, false],
        ['plugin:village:waitlist', 'Nouvelle inscription', true, false]
      ]
    )
    assert.deepEqual(first.kinds[0]?.translations, { en: { label: 'New household' } })

    mailReady = true
    assert.equal((await call('/kinds/plugin:village:waitlist', 'PUT', { email: false, push: true })).status, 204)
    assert.equal((await call('/kinds/plugin:village:accounts', 'PUT', { email: false, push: true })).status, 400)
    assert.equal((await call('/kinds/plugin:village:waitlist', 'PUT', { email: 'no', push: true })).status, 400)
    const next = (await (await call('')).json()) as { mail: boolean; kinds: { push: boolean }[] }
    assert.equal(next.mail, true)
    assert.deepEqual(
      next.kinds.map(kind => kind.push),
      [false, true]
    )
  })

  it('keeps the devices of the admin’s account, only from a push service', async () => {
    assert.equal((await call('/device', 'PUT', { target: PHONE })).status, 204)
    assert.equal((await call('/device', 'PUT', { target: { ...PHONE, endpoint: 'https://evil.test/x' } })).status, 400)
    assert.deepEqual(server.store.devices(server.admin.id), [PHONE])
    assert.equal((await call('/device', 'DELETE', { endpoint: PHONE.endpoint })).status, 204)
    assert.deepEqual(server.store.devices(server.admin.id), [])
  })
})

describe('ctx.notifyServerAdmin', () => {
  const kits: TestPlugin[] = []
  after(async () => {
    await Promise.all(kits.map(kit => kit.stop()))
  })

  it('reaches a signed plugin with kinds, and tells of its own kinds only', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'hodi-server-notice-'))
    writeFileSync(
      path.join(folder, 'plugin.json'),
      JSON.stringify({
        id: 'village',
        name: 'Village',
        version: '0.1.0',
        description: 'Des foyers.',
        api: 2,
        sdk: PLUGIN_SDK,
        permissions: { notify: true },
        serverNotifications: KINDS.map(({ type, label }) => ({ type, label }))
      })
    )
    mkdirSync(path.join(folder, 'server'))
    writeFileSync(
      path.join(folder, 'server', 'index.js'),
      `export default {
        routes: {
          'POST /tell': async (request, ctx) => {
            await ctx.notifyServerAdmin(request.body.type, { title: 'Nouveau foyer', text: 'Les Dupont.', path: 'households' })
            return { body: null }
          }
        }
      }`
    )
    const kit = await testPlugin(folder)
    kits.push(kit)
    assert.equal((await kit.route('POST /tell', { body: { type: 'household' } })).status, 200)
    assert.deepEqual(kit.serverNotices, [{ type: TYPE, ...NOTICE, text: 'Les Dupont.' }])
    assert.equal((await kit.route('POST /tell', { body: { type: 'accounts' } })).status, 500)
    assert.equal(kit.serverNotices.length, 1)
  })
})
