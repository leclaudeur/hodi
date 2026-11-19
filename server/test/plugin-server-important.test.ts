import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { type TestPlugin, testPlugin } from '../../plugin-sdk/testing.ts'
import { openDatabase } from '../db/database.ts'
import { ServerInboxStore } from '../db/server-inbox-store.ts'
import { ServerNoticeStore } from '../db/server-notice-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { serverNotifier } from '../notices/server-notifier.ts'
import { pluginServerNotice, pluginServerNotifier } from '../plugins/server-notify.ts'

// A plugin's notice someone waits on (a waitlist sign-up): under « À traiter » until the plugin says it is handled.

const KINDS = [{ type: 'waitlist', label: 'Liste d’attente', defaults: { email: false, push: false } }]
const VILLAGE = { id: 'village', name: 'Village', kinds: KINDS }
const SIGNUP = { title: 'Liste d’attente', text: 'paul@example.test attend.', important: 'waitlist:3' }

describe('a plugin’s important server notice', () => {
  const kits: TestPlugin[] = []
  after(async () => {
    await Promise.all(kits.map(kit => kit.stop()))
  })

  it('takes a short key of letters, digits and a few signs', () => {
    assert.equal(pluginServerNotice(SIGNUP)?.important, 'waitlist:3')
    for (const important of ['', 'a b', 'x'.repeat(101), 3, '../x', 'é']) {
      assert.equal(pluginServerNotice({ ...SIGNUP, important }), null, JSON.stringify(important))
    }
  })

  it('waits under its plugin’s key until that plugin handles it', async () => {
    const db = openDatabase(':memory:')
    const accounts = new UserAccountStore(db)
    accounts.createServerAdmin('admin@example.test', 'hash', 0)
    const inbox = new ServerInboxStore(db)
    const notifier = pluginServerNotifier({
      notifier: serverNotifier({
        store: new ServerNoticeStore(db),
        admins: () => accounts.serverAdmins(),
        mail: { settings: () => null, send: async () => {} },
        push: async () => {},
        languageOf: () => 'fr',
        inbox,
        now: () => 10
      }),
      log: () => {}
    })
    await notifier.send(VILLAGE, 'waitlist', SIGNUP)
    await notifier.send(VILLAGE, 'waitlist', SIGNUP)
    assert.equal(inbox.list().length, 1)
    assert.equal(inbox.waiting('plugin:village:waitlist:3'), 10)
    // Another plugin's key of the same name, or the core's, is not this one.
    notifier.handled({ id: 'club' }, 'waitlist:3')
    assert.equal(inbox.waiting('plugin:village:waitlist:3'), 10)
    assert.throws(() => notifier.handled(VILLAGE, '../code-request:1'), /invalid_key/)
    notifier.handled(VILLAGE, 'waitlist:3')
    assert.equal(inbox.waiting('plugin:village:waitlist:3'), null)
    assert.equal(inbox.list()[0]?.handledAt, 10)
  })

  it('reaches the plugin as ctx.serverNoticeHandled, and the testing kit shows it waiting', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'hodi-server-important-'))
    writeFileSync(
      path.join(folder, 'plugin.json'),
      JSON.stringify({
        id: 'village',
        name: 'Village',
        version: '0.1.0',
        description: 'Des foyers.',
        api: 2,
        permissions: { notify: true },
        serverNotifications: KINDS.map(({ type, label }) => ({ type, label }))
      })
    )
    mkdirSync(path.join(folder, 'server'))
    writeFileSync(
      path.join(folder, 'server', 'index.js'),
      `export default {
        routes: {
          'POST /join': async (_request, ctx) => {
            await ctx.notifyServerAdmin('waitlist', ${JSON.stringify(SIGNUP)})
            return { body: null }
          },
          'POST /invite': async (_request, ctx) => {
            await ctx.serverNoticeHandled('waitlist:3')
            return { body: null }
          }
        }
      }`
    )
    const kit = await testPlugin(folder)
    kits.push(kit)
    await kit.route('POST /join')
    await kit.route('POST /join')
    assert.deepEqual(
      kit.serverNotices.map(notice => notice.waiting),
      [true]
    )
    assert.equal((await kit.route('POST /invite')).status, 200)
    assert.deepEqual(
      kit.serverNotices.map(notice => notice.waiting),
      [false]
    )
    // Handled, the same key waits again when the person signs up again.
    await kit.route('POST /join')
    assert.deepEqual(
      kit.serverNotices.map(notice => notice.waiting),
      [false, true]
    )
  })
})
