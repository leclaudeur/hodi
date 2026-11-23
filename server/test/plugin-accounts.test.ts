import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import { AccountLoginStore } from '../db/account-login-store.ts'
import { openDatabase } from '../db/database.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { PluginAccountStore } from '../db/plugin-account-store.ts'
import { pluginAccounts } from '../plugins/accounts.ts'
import type { PluginAccount } from '../plugins/api.ts'

describe('accounts as a plugin sees them', () => {
  const db = openDatabase(':memory:')
  const store = new UserAccountStore(db)
  const throttle = new LoginThrottle(3)
  const logins = new AccountLoginStore(db)
  const removed: number[] = []
  const accounts = pluginAccounts({
    accounts: store,
    logins,
    made: new PluginAccountStore(db),
    hooks: { remove: account => removed.push(account.id) },
    throttle,
    now: () => 5
  })
  const seen = (id: number, email: string, more: Partial<PluginAccount> = {}): PluginAccount => ({
    id,
    email,
    name: null,
    createdAt: 5,
    loginOnly: false,
    serverAdmin: false,
    mine: true,
    suspended: false,
    ...more
  })

  before(async () => {
    store.createServerAdmin('admin@example.test', await hashPassword('admin-password-1'), 0)
  })

  it('show an id, an e-mail and whether it is the server admin, never a secret', () => {
    assert.deepEqual(
      accounts.get(1, 'p'),
      seen(1, 'admin@example.test', { createdAt: null, serverAdmin: true, mine: false })
    )
    assert.deepEqual(accounts.findByEmail(' Admin@Example.test ', 'p'), accounts.get(1, 'p'))
    for (const odd of [0, -1, 1.5, '1', null, 2]) assert.equal(accounts.get(odd, 'p'), null, String(odd))
    assert.equal(accounts.findByEmail('nobody@example.test', 'p'), null)
    assert.equal(accounts.findByEmail(42, 'p'), null)
  })

  it('make an account with a password, once per address', async () => {
    const made = await accounts.create({ email: 'Marie@example.test', password: 'une phrase solide' }, 'p')
    assert.deepEqual(made, seen(2, 'marie@example.test'))
    assert.equal(accounts.get(2, 'other')?.mine, false)
    assert.equal(await accounts.create({ email: 'marie@example.test', password: 'une autre phrase' }, 'p'), null)
    await assert.rejects(accounts.create({ email: 'paul@example.test', provider: 'google' }, 'p'), /invalid_account/)
    await assert.rejects(accounts.create({ email: 'paul@example.test' }, 'p'), /invalid_account/)
    await assert.rejects(accounts.create({ email: 'paul@example.test', password: 'court' }, 'p'), /invalid_account/)
    await assert.rejects(
      accounts.create({ email: 'pas une adresse', password: 'une phrase solide' }, 'p'),
      /invalid_account/
    )
    await assert.rejects(accounts.create(null, 'p'), /invalid_account/)
  })

  it('check a password against the throttle of the address the call came from', async () => {
    const check = (email: string, password: unknown, client: string) =>
      accounts.checkPassword(email, password, client, 'p')
    assert.deepEqual(await check('marie@example.test', 'une phrase solide', 'a'), accounts.get(2, 'p'))
    assert.equal(await check('marie@example.test', 'faux', 'a'), null)
    assert.equal(await check('nobody@example.test', 'faux', 'a'), null)
    assert.equal(await check('marie@example.test', 42, 'a'), null)
    // Three failures for this address: refused before any hashing, even the right password.
    await assert.rejects(check('marie@example.test', 'une phrase solide', 'a'), /throttled/)
    assert.equal(throttle.check(5, 'a').allowed, false)
    // Another address still gets in.
    assert.deepEqual(await check('marie@example.test', 'une phrase solide', 'b'), accounts.get(2, 'p'))
  })

  it("make an account with a plugin's login and no password, which only that plugin finds", async () => {
    const made = await accounts.create({ email: 'paul@example.test', login: 'google:1' }, 'p')
    assert.deepEqual(made, seen(3, 'paul@example.test', { loginOnly: true }))
    assert.deepEqual(accounts.findByLogin('google:1', 'p'), made)
    assert.equal(accounts.findByLogin('google:1', 'other'), null)
    assert.equal(accounts.findByLogin('google:2', 'p'), null)
    // No password signs it in, not even an empty one.
    assert.equal(await accounts.checkPassword('paul@example.test', '', 'c', 'p'), null)
    // A login leads to one account.
    await assert.rejects(accounts.create({ email: 'jean@example.test', login: 'google:1' }, 'p'), /login_taken/)
    for (const odd of ['', 'a b', 'x'.repeat(201), 42, 'a\nb'])
      await assert.rejects(accounts.create({ email: 'jean@example.test', login: odd }, 'p'), /invalid_login/)
    // A password set later makes it an ordinary account.
    store.setPassword(3, await hashPassword('une phrase solide'), 1)
    assert.equal(accounts.get(3, 'p')?.loginOnly, false)
  })

  it('list, suspend, resume and remove only the accounts this plugin made', () => {
    assert.deepEqual(
      accounts.list('p').map(account => account.id),
      [3, 2]
    )
    assert.deepEqual(accounts.list('other'), [])
    const generation = store.get(2)!.sessionGeneration
    accounts.suspend(2, 'p')
    // Signed out everywhere, and refused at the next sign-in with the plugin's own words.
    assert.equal(store.get(2)!.sessionGeneration, generation + 1)
    assert.equal(store.get(2)!.suspendedBy, 'p')
    assert.equal(accounts.get(2, 'p')?.suspended, true)
    accounts.resume(2, 'p')
    assert.equal(store.get(2)!.suspendedBy, null)
    for (const [id, plugin] of [
      [1, 'p'],
      [2, 'other'],
      [99, 'p'],
      ['2', 'p']
    ] as const) {
      assert.throws(() => accounts.suspend(id, plugin), /not_allowed/, `${id} ${plugin}`)
      assert.throws(() => accounts.remove(id, plugin), /not_allowed/, `${id} ${plugin}`)
    }
    accounts.remove(3, 'p')
    assert.deepEqual(removed, [3])
  })

  it('give a login to an account, never the server admin, and one account per login', () => {
    assert.equal(accounts.addLogin(2, 'google:2', 'p'), true)
    assert.equal(accounts.addLogin(2, 'google:2', 'p'), true)
    assert.equal(accounts.addLogin(3, 'google:2', 'p'), false)
    assert.equal(accounts.findByLogin('google:2', 'p')?.id, 2)
    assert.throws(() => accounts.addLogin(1, 'google:admin', 'p'), /not_allowed/)
    assert.throws(() => accounts.addLogin(99, 'google:99', 'p'), /not_allowed/)
    // Removing the plugin takes its logins: a plugin given the same id later finds nobody.
    accounts.suspend(2, 'p')
    new PluginStore(db).forget('p')
    assert.equal(accounts.findByLogin('google:2', 'p'), null)
    // Its accounts stay, as anyone's: none is its any more, none stays suspended.
    assert.equal(store.get(2)!.suspendedBy, null)
    assert.deepEqual(accounts.list('p'), [])
  })

  it('give an account the first name its person typed', async () => {
    // As Mon compte shows it, and only to the plugin that made the account.
    const named = await accounts.create(
      { email: 'lou@example.test', password: 'une phrase solide', name: ' Lou ' },
      'q'
    )
    assert.equal(named?.name, 'Lou')
    assert.equal(accounts.get(named!.id, 'p')?.name, null)
    await assert.rejects(
      accounts.create({ email: 'eve@example.test', password: 'une phrase solide', name: '  ' }, 'q'),
      /invalid_account/
    )
  })
})
