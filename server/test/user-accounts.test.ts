import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { migrate, versionBefore } from '../db/migrations.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { UserAccountStore, cleanEmail } from '../db/user-account-store.ts'

const NOW = Date.UTC(2026, 10, 6, 9)

describe('personal accounts', () => {
  it('keeps an install set up before them set up', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore('CREATE TABLE users'))
    db.prepare("UPDATE accounts SET name = 'Chez nous', password_hash = 'hash', password_changed_at = ?").run(NOW)
    migrate(db)
    const household = new HouseholdStore(db).get()
    assert.equal(household.setUpAt, NOW)
  })

  it('leaves a new install waiting for its first-run screens', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    assert.equal(new HouseholdStore(db).isSetUp(), false)
    assert.equal(new UserAccountStore(db).any(), false)
  })

  it('makes one server admin, found by its address whatever the case', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const accounts = new UserAccountStore(db)
    const admin = accounts.createServerAdmin('antho@example.com', 'hash', NOW)
    assert.equal(admin?.serverAdmin, true)
    assert.equal(accounts.createServerAdmin('autre@example.com', 'hash', NOW), null)
    assert.equal(accounts.byEmail('antho@example.com')?.id, admin?.id)

    assert.equal(accounts.profileOf(admin!.id), null)
    accounts.linkProfile(admin!.id, 1)
    assert.equal(accounts.profileOf(admin!.id), 1)
    assert.equal(accounts.revokeSessions(admin!.id), 1)
  })

  it('signs every device out with a new password, but not with the same password hashed again', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const accounts = new UserAccountStore(db)
    const { id } = accounts.createServerAdmin('antho@example.com', 'hash', NOW)!
    accounts.upgradePassword(id, 'stronger hash')
    assert.equal(accounts.get(id)?.sessionGeneration, 0)
    assert.equal(accounts.get(id)?.passwordChangedAt, NOW)
    accounts.setPassword(id, 'new hash', NOW + 1)
    assert.equal(accounts.get(id)?.sessionGeneration, 1)
    assert.equal(accounts.get(id)?.passwordHash, 'new hash')
  })

  it('takes an address trimmed and in lower case, or nothing', () => {
    assert.equal(cleanEmail('  Antho@Example.COM '), 'antho@example.com')
    assert.equal(cleanEmail('antho'), null)
    assert.equal(cleanEmail('antho@example'), null)
    assert.equal(cleanEmail('an tho@example.com'), null)
    assert.equal(cleanEmail(`${'a'.repeat(250)}@example.com`), null)
    assert.equal(cleanEmail(42), null)
  })
})
