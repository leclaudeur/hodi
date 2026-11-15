import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword } from '../auth/password.ts'
import { AccountLoginStore } from '../db/account-login-store.ts'
import { openDatabase } from '../db/database.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { pluginAccounts } from '../plugins/accounts.ts'

describe('accounts as a plugin sees them', () => {
  const db = openDatabase(':memory:')
  const store = new UserAccountStore(db)
  const throttle = new LoginThrottle(3)
  const logins = new AccountLoginStore(db)
  const accounts = pluginAccounts({ accounts: store, logins, throttle })

  before(async () => {
    store.createServerAdmin('admin@example.test', await hashPassword('admin-password-1'), 0)
  })

  it('show an id, an e-mail and whether it is the server admin, never a secret', () => {
    assert.deepEqual(accounts.get(1), { id: 1, email: 'admin@example.test', loginOnly: false, serverAdmin: true })
    assert.deepEqual(accounts.findByEmail(' Admin@Example.test '), accounts.get(1))
    for (const odd of [0, -1, 1.5, '1', null, 2]) assert.equal(accounts.get(odd), null, String(odd))
    assert.equal(accounts.findByEmail('nobody@example.test'), null)
    assert.equal(accounts.findByEmail(42), null)
  })

  it('make an account with a password, once per address', async () => {
    const made = await accounts.create({ email: 'Marie@example.test', password: 'une phrase solide' }, 'p')
    assert.deepEqual(made, { id: 2, email: 'marie@example.test', loginOnly: false, serverAdmin: false })
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
    assert.deepEqual(await accounts.checkPassword('marie@example.test', 'une phrase solide', 'a'), accounts.get(2))
    assert.equal(await accounts.checkPassword('marie@example.test', 'faux', 'a'), null)
    assert.equal(await accounts.checkPassword('nobody@example.test', 'faux', 'a'), null)
    assert.equal(await accounts.checkPassword('marie@example.test', 42, 'a'), null)
    // Three failures for this address: refused before any hashing, even the right password.
    await assert.rejects(accounts.checkPassword('marie@example.test', 'une phrase solide', 'a'), /throttled/)
    assert.equal(throttle.check(Date.now(), 'a').allowed, false)
    // Another address still gets in.
    assert.deepEqual(await accounts.checkPassword('marie@example.test', 'une phrase solide', 'b'), accounts.get(2))
  })

  it("make an account with a plugin's login and no password, which only that plugin finds", async () => {
    const made = await accounts.create({ email: 'paul@example.test', login: 'google:1' }, 'p')
    assert.deepEqual(made, { id: 3, email: 'paul@example.test', loginOnly: true, serverAdmin: false })
    assert.deepEqual(accounts.findByLogin('google:1', 'p'), made)
    assert.equal(accounts.findByLogin('google:1', 'other'), null)
    assert.equal(accounts.findByLogin('google:2', 'p'), null)
    // No password signs it in, not even an empty one.
    assert.equal(await accounts.checkPassword('paul@example.test', '', 'c'), null)
    // A login leads to one account.
    await assert.rejects(accounts.create({ email: 'jean@example.test', login: 'google:1' }, 'p'), /login_taken/)
    for (const odd of ['', 'a b', 'x'.repeat(201), 42, 'a\nb'])
      await assert.rejects(accounts.create({ email: 'jean@example.test', login: odd }, 'p'), /invalid_login/)
    // A password set later makes it an ordinary account.
    store.setPassword(3, await hashPassword('une phrase solide'), 1)
    assert.equal(accounts.get(3)?.loginOnly, false)
  })

  it('give a login to an account, never the server admin, and one account per login', () => {
    assert.equal(accounts.addLogin(2, 'google:2', 'p'), true)
    assert.equal(accounts.addLogin(2, 'google:2', 'p'), true)
    assert.equal(accounts.addLogin(3, 'google:2', 'p'), false)
    assert.equal(accounts.findByLogin('google:2', 'p')?.id, 2)
    assert.throws(() => accounts.addLogin(1, 'google:admin', 'p'), /not_allowed/)
    assert.throws(() => accounts.addLogin(99, 'google:99', 'p'), /not_allowed/)
    // Removing the plugin takes its logins: a plugin given the same id later finds nobody.
    new PluginStore(db).forget('p')
    assert.equal(accounts.findByLogin('google:2', 'p'), null)
  })
})
