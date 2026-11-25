import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { PluginStore } from '../db/plugin-store.ts'
import type { AlertPayload } from '../news/followed-alerts.ts'
import { PLUGIN_API } from '../plugins/manifest.ts'
import { PLUGIN_NOTICES_PER_DAY, PLUGIN_NOTICES_PER_HOUR, pluginNotice, pluginNotifier } from '../plugins/notify.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'
import { callContext } from '../plugins/call-context.ts'
import { TEST_TRUSTED_KEYS, signTestFolder } from './helpers/signing.ts'
import { PLUGIN_SDK } from '../plugins/plugin-sdk.ts'

// Profiles 1, 2 and 3 are there; account 7 reads with profile 2, account 8 has no profile yet. Profiles 1 and 2 are
// family; 3 has no tie with either.
const PROFILES = new Set([1, 2, 3])
const PROFILE_OF: Record<number, number> = { 7: 2 }
const TIES = new Set(['1|2', '2|1'])

const notifierWith = (pushed: { profileId: number; payload: AlertPayload }[], clock = { now: 0 }) =>
  pluginNotifier({
    hasProfile: id => PROFILES.has(id),
    profileOf: id => PROFILE_OF[id] ?? null,
    knows: (reader, profileId) => TIES.has(`${reader}|${profileId}`),
    push: async (profileId, payload) => {
      pushed.push({ profileId, payload })
    },
    now: () => clock.now,
    log: () => {}
  })

const PLUGIN = { id: 'club', name: 'Club' }

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

  it('tells a profile, or the profile of an account', async () => {
    const pushed: { profileId: number; payload: AlertPayload }[] = []
    const notifier = notifierWith(pushed)
    await notifier.send(PLUGIN, { profileId: 1, title: 'Bonjour', text: 'Un mot.', path: 'inbox' }, null)
    assert.deepEqual(pushed, [
      {
        profileId: 1,
        payload: {
          title: 'Club · Bonjour',
          body: 'Un mot.',
          url: '#/settings/plugin/club/inbox',
          tag: 'plugin:club',
          badge: null
        }
      }
    ])
    await assert.rejects(notifier.send(PLUGIN, { profileId: 99, title: 'a', text: 'b' }, null), /unknown_profile/)
    // An account: the profile it reads with; one with none yet reaches nobody.
    pushed.length = 0
    await notifier.send(PLUGIN, { accountId: 7, title: 'a', text: 'b' }, null)
    await notifier.send(PLUGIN, { accountId: 8, title: 'a', text: 'b' }, null)
    assert.deepEqual(
      pushed.map(({ profileId }) => profileId),
      [2]
    )
    await assert.rejects(
      notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b', url: 'x' }, null),
      /invalid_notice/
    )
  })

  it('within a reader’s call, reaches only the reader and the people around them', async () => {
    const pushed: { profileId: number; payload: AlertPayload }[] = []
    const notifier = notifierWith(pushed)
    await notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b' }, 1)
    await notifier.send(PLUGIN, { accountId: 7, title: 'a', text: 'b' }, 1)
    // Profile 3 exists, but the reader has no tie with it: told as if it did not.
    await assert.rejects(notifier.send(PLUGIN, { profileId: 3, title: 'a', text: 'b' }, 1), /unknown_profile/)
    await notifier.send(PLUGIN, { profileId: 3, title: 'a', text: 'b' }, null)
    assert.deepEqual(
      pushed.map(({ profileId }) => profileId),
      [1, 2, 3]
    )
  })

  it('sends a profile a few an hour and ten a day at most from one plugin', async () => {
    const pushed: { profileId: number; payload: AlertPayload }[] = []
    const clock = { now: 0 }
    const notifier = notifierWith(pushed, clock)
    for (let index = 0; index < PLUGIN_NOTICES_PER_HOUR; index++)
      await notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b' }, null)
    await assert.rejects(notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b' }, null), /too_many_notices/)
    for (let index = PLUGIN_NOTICES_PER_HOUR; index < PLUGIN_NOTICES_PER_DAY; index++) {
      if (index % PLUGIN_NOTICES_PER_HOUR === 0) clock.now += 60 * 60 * 1000
      await notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b' }, null)
    }
    clock.now += 60 * 60 * 1000
    await assert.rejects(notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b' }, null), /too_many_notices/)
    // Another plugin, another count.
    await notifier.send({ id: 'other', name: 'Other' }, { profileId: 1, title: 'a', text: 'b' }, null)
    clock.now += 24 * 60 * 60 * 1000
    await notifier.send(PLUGIN, { profileId: 1, title: 'a', text: 'b' }, null)
    assert.equal(pushed.length, PLUGIN_NOTICES_PER_DAY + 2)
  })
})

const registries: PluginRegistry[] = []
after(async () => {
  await Promise.all(registries.map(registry => registry.stop()))
})

describe('ctx.notify', () => {
  it('exists only with permissions.notify, and reaches Hodi within a call', async () => {
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
          sdk: PLUGIN_SDK,
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
      registry.get(id)!.sandbox!.call('routes', 'POST /tell', { body }, callContext())
    assert.deepEqual(await tell('teller', { profileId: 1, title: 'Salut', text: 'Un mot.' }), { body: 'sent' })
    assert.deepEqual(await tell('teller', { profileId: 99, title: 'Salut', text: 'Un mot.' }), {
      body: 'unknown_profile'
    })
    assert.deepEqual(await tell('silent', { profileId: 1, title: 'Salut', text: 'Un mot.' }), { body: 'none' })
    // A route of profile 3's: profile 1 is not theirs to reach.
    const asThree = await registry
      .get('teller')!
      .sandbox!.call(
        'routes',
        'POST /tell',
        { body: { profileId: 1, title: 'Salut', text: 'Un mot.' } },
        callContext(true, undefined, 3)
      )
    assert.deepEqual(asThree, { body: 'unknown_profile' })
    assert.deepEqual(
      pushed.map(({ profileId, payload }) => [profileId, payload.title]),
      [[1, 'Teller · Salut']]
    )
  })
})
