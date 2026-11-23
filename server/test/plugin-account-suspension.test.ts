import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { after, describe, it } from 'node:test'
import { migrate, versionBefore } from '../db/migrations.ts'
import { PluginAccountStore } from '../db/plugin-account-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { SAM_PASSWORD, startHousehold } from './helpers/household-env.ts'

// An account its plugin suspended (ctx.accounts.suspend) is signed out on every device and signs in nowhere, with the
// plugin's own words, until the plugin resumes it.

describe('an account a plugin suspended', async () => {
  const household = await startHousehold()
  const { accounts, samAccount, call, sam, db } = household
  const made = new PluginAccountStore(db)
  made.markMade(samAccount.id, 'village')
  after(() => household.close())

  const signIn = () => call('/login', '', 'POST', { email: 'sam@example.com', password: SAM_PASSWORD })

  it('is refused at sign-in with the plugin that suspended it', async () => {
    assert.equal((await call('/account', sam)).status, 200)
    made.setSuspended(samAccount.id, 'village', 1)
    accounts.revokeSessions(samAccount.id)
    assert.equal((await call('/account', sam)).status, 401)
    const refused = await signIn()
    assert.equal(refused.status, 403)
    assert.deepEqual(await refused.json(), { error: 'sign_in_refused', plugin: 'village', message: 'signIn.suspended' })
  })

  it('signs in again once resumed', async () => {
    made.setSuspended(samAccount.id, 'village', null)
    assert.equal((await signIn()).status, 204)
  })

  it('is never the server admin, whom no plugin can lock out', () => {
    const admin = household.anthoAccount.id
    made.markMade(admin, 'village')
    assert.equal(made.setSuspended(admin, 'village', 1), false)
    assert.equal(accounts.get(admin)?.suspendedBy, null)
  })
})

describe('the plugin accounts migration', () => {
  it('gives each person of a household a plugin made to that plugin, suspended with it', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore('ALTER TABLE users ADD COLUMN made_by_plugin'))
    const insert = db.prepare(
      'INSERT INTO users (id, email, password_hash, password_changed_at, created_at) VALUES (?, ?, ?, 0, 0)'
    )
    for (const [id, email] of [
      [7, 'a@b.c'],
      [8, 'd@e.f'],
      [9, 'g@h.i']
    ] as const)
      insert.run(id, email, 'x')
    db.exec(
      "INSERT INTO accounts (id, name, created_at, made_by_plugin, suspended_at) VALUES (5, 'Les Dupont', 0, 'village', 3)"
    )
    db.exec("INSERT INTO accounts (id, name, created_at, made_by_plugin) VALUES (6, 'Les Martin', 0, 'village')")
    const profile = db.prepare(
      "INSERT INTO profiles (account_id, name, color, position, created_at, user_id) VALUES (?, 'A', 'tech', 0, 0, ?)"
    )
    profile.run(5, 7)
    profile.run(6, 8)
    profile.run(1, 9)
    migrate(db)
    const accounts = new UserAccountStore(db as never)
    const made = new PluginAccountStore(db as never)
    assert.deepEqual(made.of(7), { madeByPlugin: 'village', suspendedAt: 3 })
    assert.equal(accounts.get(7)?.suspendedBy, 'village')
    assert.deepEqual(made.of(8), { madeByPlugin: 'village', suspendedAt: null })
    assert.deepEqual(made.of(9), { madeByPlugin: null, suspendedAt: null })
    assert.deepEqual(made.madeBy('village'), [8, 7])
  })
})
