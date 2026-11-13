import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { inHousehold } from '../db/household-scope.ts'
import { PluginHouseholdStore } from '../db/plugin-household-store.ts'
import { SignInCodeStore } from '../db/sign-in-code-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { pluginHouseholds } from '../plugins/households.ts'

describe('households as a plugin sees and makes them', () => {
  const db = openDatabase(':memory:')
  const accounts = new UserAccountStore(db)
  const codes = new SignInCodeStore(db, Buffer.alloc(32, 7))
  const set: string[] = []
  const created: number[] = []
  const deleted: number[] = []
  const removed: number[] = []
  const households = pluginHouseholds({
    store: new PluginHouseholdStore(db),
    accounts,
    codes,
    hooks: {
      setUp: language => set.push(`${new HouseholdStore(db).get().name}:${language}`),
      profileCreated: id => created.push(id),
      profileDeleted: id => deleted.push(id),
      removed: id => removed.push(id)
    },
    now: () => 1_000
  })
  new HouseholdStore(db).setUp({ name: 'Chez nous', timeZone: null, country: null, language: 'fr', ai: null }, 1)
  const admin = accounts.createServerAdmin('admin@example.test', 'scrypt:hash', 0)!
  const marie = accounts.create('marie@example.test', 'scrypt:hash', 0)!

  it('lists the households, the core one never its own', () => {
    assert.deepEqual(households.list('village'), [
      { id: 1, name: 'Chez nous', language: 'fr', createdAt: 1, suspended: false, mine: false, photo: null }
    ])
    assert.equal(households.get('village', 9), null)
    assert.equal(households.get('village', '1'), null)
  })

  it('gives the address of a household’s photo, set in Réglages › Foyer', () => {
    const core = new HouseholdStore(db, 1)
    core.setPhoto({ data: Buffer.from('png'), type: 'image/png' }, 42)
    assert.equal(households.get('village', 1)?.photo, '/api/households/1/photo?v=42')
    core.setPhoto(null, 43)
    assert.equal(households.get('village', 1)?.photo, null)
  })

  it('makes a household with a waiting admin and a code, or with an account', () => {
    const waiting = households.create('village', { name: 'Famille Martin', admin: { name: 'Paul' } })
    assert.equal(waiting.mine, true)
    assert.equal(waiting.language, 'fr')
    assert.match(waiting.code!.code, /^[A-HJKMNP-Z2-9]{8}$/)
    assert.equal(codes.peek(waiting.code!.code, 2_000)?.householdId, waiting.id)
    assert.deepEqual(set, ['Famille Martin:fr'])

    const joined = households.create('village', {
      name: 'Famille Dupont',
      language: 'en',
      admin: { name: 'Marie', accountId: marie.id }
    })
    assert.equal(joined.code, null)
    assert.equal(
      inHousehold(joined.id, () => accounts.profileOf(marie.id)),
      created.at(-1)
    )
    assert.deepEqual(
      households.of('village', marie.id).map(household => household.name),
      ['Famille Dupont']
    )
    // Another plugin sees it, but not as its own.
    assert.equal(households.get('other', joined.id)?.mine, false)

    for (const wrong of [
      { name: 'X', admin: { name: 'Admin', accountId: admin.id } },
      { name: 'X', admin: { name: 'Paul', accountId: 999 } },
      { name: '', admin: null },
      { name: 'X', admin: null, extra: true },
      { name: 'X', language: 'de', admin: null },
      null
    ]) {
      assert.throws(() => households.create('village', wrong), /invalid_household/, JSON.stringify(wrong))
    }
  })

  it('suspends, resumes and removes only what the plugin made', () => {
    const own = households.create('village', { name: 'À supprimer', admin: null })
    assert.throws(() => households.suspend('village', 1), /not_allowed/)
    assert.throws(() => households.remove('village', 1), /not_allowed/)
    assert.throws(() => households.suspend('other', own.id), /not_allowed/)
    households.suspend('village', own.id)
    assert.equal(households.get('village', own.id)?.suspended, true)
    households.resume('village', own.id)
    assert.equal(households.get('village', own.id)?.suspended, false)
    households.remove('village', own.id)
    assert.equal(households.get('village', own.id), null)
    assert.equal(deleted.length, 1)
    // The plugins forget it too.
    assert.deepEqual(removed, [own.id])
    assert.equal(
      (db.prepare('SELECT count(*) AS n FROM profiles WHERE account_id = ?').get(own.id) as { n: number }).n,
      0
    )
    // Its people keep their accounts.
    assert.ok(accounts.get(marie.id))
  })
})
