import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { PluginStore } from '../db/plugin-store.ts'
import type { AlertPayload } from '../news/followed-alerts.ts'
import { PLUGIN_API } from '../plugins/manifest.ts'
import { PLUGIN_NOTICES_PER_DAY, pluginNotice, pluginNotifier } from '../plugins/notify.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'
import { callContext } from '../plugins/call-context.ts'
import { TEST_TRUSTED_KEYS, signTestFolder } from './helpers/signing.ts'

// Two households: profiles 1 and 2 in household 1, profile 3 in household 2; account 7 has profiles 2 and 3.
const HOUSEHOLDS: Record<number, number> = { 1: 1, 2: 1, 3: 2 }
const PROFILES_OF: Record<number, { profileId: number; householdId: number }[]> = {
  7: [
    { profileId: 2, householdId: 1 },
    { profileId: 3, householdId: 2 }
  ]
}

const notifierWith = (pushed: { profileId: number; payload: AlertPayload }[], clock = { now: 0 }) =>
  pluginNotifier({
    householdOf: id => HOUSEHOLDS[id] ?? null,
    profilesOf: id => PROFILES_OF[id] ?? [],
    push: async (profileId, payload) => {
      pushed.push({ profileId, payload })
    },
    now: () => clock.now,
    log: () => {}
  })

const PLUGIN = { id: 'village', name: 'Village' }

describe('notifications of plugins', () => {
  it('takes short plain text, one person, and a path under its page', () => {
    assert.deepEqual(pluginNotice({ profileId: 1, title: ' Inscription ', text: 'Ta demande est acceptée.' }), {
      profileId: 1,
      accountId: null,
      title: 'Inscription',
      text: 'Ta demande est acceptée.',
      path: null
    })
    assert.equal(pluginNotice({ accountId: 7, title: 'a', text: 'b', path: 'requests/12' })?.path, 'requests/12')
    const refused = [
      null,
      { title: 'a', text: 'b' },
      { profileId: 1, accountId: 7, title: 'a', text: 'b' },
      { profileId: '1', title: 'a', text: 'b' },
      { profileId: 1, title: '', text: 'b' },
      { profileId: 1, title: 'a\nb', text: 'b' },
      { profileId: 1, title: 'x'.repeat(81), text: 'b' },
      { profileId: 1, title: 'a', text: 'x'.repeat(241) },
      { profileId: 1, title: 'a', text: 'b', path: '../server' },
      { profileId: 1, title: 'a', text: 'b', path: 'https://evil.test' },
      { profileId: 1, title: 'a', text: 'b', url: 'https://evil.test' }
    ]
    for (const value of refused) assert.equal(pluginNotice(value), null, JSON.stringify(value))
  })

  it("tells a household's people only within its calls, anyone from a task", async () => {
    const pushed: { profileId: number; payload: AlertPayload }[] = []
    const notifier = notifierWith(pushed)
    await notifier.send(PLUGIN, { profileId: 1, title: 'Bonjour', text: 'Un mot.', path: 'inbox' }, 1)
    assert.deepEqual(pushed, [
      {
        profileId: 1,
        payload: {
          title: 'Village · Bonjour',
          body: 'Un mot.',
          url: '#/settings/plugin/village/inbox',
          tag: 'plugin:village',
          badge: null
        }
      }
    ])
    await assert.rejects(notifier.send(PLUGIN, { profileId: 3, title: 'a', text: 'b' }, 1), /unknown_profile/)
    await assert.rejects(notifier.send(PLUGIN, { profileId: 99, title: 'a', text: 'b' }, null), /unknown_profile/)
    // An account: its profiles in the call's household, or all of them from a task.
    pushed.length = 0
    await notifier.send(PLUGIN, { accountId: 7, title: 'a', text: 'b' }, 1)
    await notifier.send(PLUGIN, { accountId: 7, title: 'a', text: 'b' }, null)
    assert.deepEqual(
      pushed.map(({ profileId }) => profileId),
      [2, 2, 3]
    )
    await assert.rejects(notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b', url: 'x' }, 1), /invalid_notice/)
  })

  it('sends a profile ten a day at most from one plugin', async () => {
    const pushed: { profileId: number; payload: AlertPayload }[] = []
    const clock = { now: 0 }
    const notifier = notifierWith(pushed, clock)
    for (let index = 0; index < PLUGIN_NOTICES_PER_DAY; index++)
      await notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b' }, 1)
    await assert.rejects(notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b' }, 1), /too_many_notices/)
    // Another plugin, another count.
    await notifier.send({ id: 'other', name: 'Other' }, { profileId: 1, title: 'a', text: 'b' }, 1)
    clock.now += 24 * 60 * 60 * 1000
    await notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b' }, 1)
    assert.equal(pushed.length, PLUGIN_NOTICES_PER_DAY + 2)
  })
})

const registries: PluginRegistry[] = []
after(async () => {
  await Promise.all(registries.map(registry => registry.stop()))
})

describe('ctx.notify', () => {
  it('exists only with permissions.notify, and reaches Hodi with the call’s household', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-notify-'))
    const server = `export default { routes: { 'POST /tell': async (request, ctx) => {
      if (!ctx.notify) return { body: 'none' }
      return { body: await ctx.notify(request.body).then(() => 'sent', error => error.message) }
    } } }`
    for (const [id, notify] of [
      ['teller', true],
      ['silent', false]
    ] as const) {
      mkdirSync(path.join(dir, id))
      writeFileSync(
        path.join(dir, id, 'plugin.json'),
        JSON.stringify({
          id,
          name: 'Teller',
          version: '0.1.0',
          description: 'Tells.',
          api: PLUGIN_API,
          permissions: { notify }
        })
      )
      writeFileSync(path.join(dir, id, 'server.js'), server)
      signTestFolder(path.join(dir, id))
    }
    const pushed: { profileId: number; payload: AlertPayload }[] = []
    const registry = await loadPlugins({
      dir,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-notify-data-')),
      store: new PluginStore(openDatabase(':memory:')),
      notifier: notifierWith(pushed),
      trustedKeys: TEST_TRUSTED_KEYS,
      log: () => {}
    })
    registries.push(registry)
    const tell = (id: string, body: unknown) =>
      registry.get(id)!.sandbox!.call('routes', 'POST /tell', { body }, callContext(1))
    assert.deepEqual(await tell('teller', { profileId: 1, title: 'Salut', text: 'Un mot.' }), { body: 'sent' })
    assert.deepEqual(await tell('teller', { profileId: 3, title: 'Salut', text: 'Un mot.' }), {
      body: 'unknown_profile'
    })
    assert.deepEqual(await tell('silent', { profileId: 1, title: 'Salut', text: 'Un mot.' }), { body: 'none' })
    assert.deepEqual(
      pushed.map(({ profileId, payload }) => [profileId, payload.title]),
      [[1, 'Teller · Salut']]
    )
  })
})
