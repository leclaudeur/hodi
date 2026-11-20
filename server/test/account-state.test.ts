import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserStore } from '../db/user-store.ts'

// A person's preferences, Enregistrés, Historique, Masquer and the stories seen are their account's: a profile only
// shows them, in whatever household the account reads.

const NOW = Date.UTC(2026, 10, 20, 9)
const item = (id: string) => ({ id, title: `Article ${id}` })

const setup = () => {
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  const count = (table: string, owner: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner = ?`).get(owner) as { n: number }).n
  return { db, profiles, accounts, count }
}

const fill = (state: UserStore) => {
  state.setPreferences({ hiddenTopics: ['sport'], fontSize: 'large' }, NOW)
  state.save(item('saved'), null, NOW, NOW)
  state.markRead(['read'], NOW)
  state.markRead(['put-away'], NOW, true)
  state.markStoriesSeen(['story'], NOW)
}

describe('a person’s own state', () => {
  it('stays with the account when its profile goes, and comes back on its next one', () => {
    const { db, profiles, accounts, count } = setup()
    const sam = profiles.create('Sam', 'tech', NOW)!
    const account = accounts.create('sam@example.com', 'unused-hash', NOW)!
    accounts.linkProfile(account.id, sam.id)
    fill(new UserStore(db, sam.id))

    // Leaving the household (or removed by the admin): the profile goes, its rows stay the account's.
    profiles.delete(sam.id)
    for (const table of ['profile_settings', 'saved_articles', 'read_articles', 'seen_stories'])
      assert.ok(count(table, `a${account.id}`) > 0, table)

    const again = profiles.create('Sam', 'tech', NOW)!
    accounts.linkProfile(account.id, again.id)
    const state = new UserStore(db, again.id).getState()
    assert.deepEqual(state.preferences, { hiddenTopics: ['sport'], fontSize: 'large' })
    assert.deepEqual(
      state.saved.map(entry => entry.item.id),
      ['saved']
    )
    assert.deepEqual(state.read.toSorted(), ['put-away', 'read'])
    assert.deepEqual(state.hidden, ['put-away'])
    assert.ok(new UserStore(db, again.id).knownSince(NOW - 1).has('story'))
  })

  it('hands a profile’s own over to the account it gets, and goes with the account when it is deleted', () => {
    const { db, profiles, accounts, count } = setup()
    const noe = profiles.create('Noé', 'sport', NOW)!
    fill(new UserStore(db, noe.id))
    assert.equal(count('saved_articles', `p${noe.id}`), 1)

    const account = accounts.create('noe@example.com', 'unused-hash', NOW)!
    accounts.linkProfile(account.id, noe.id)
    assert.deepEqual([count('saved_articles', `p${noe.id}`), count('saved_articles', `a${account.id}`)], [0, 1])
    assert.deepEqual(new UserStore(db, noe.id).getState().preferences, { hiddenTopics: ['sport'], fontSize: 'large' })

    db.prepare('DELETE FROM users WHERE id = ?').run(account.id)
    for (const table of ['profile_settings', 'saved_articles', 'read_articles', 'seen_stories'])
      assert.equal(count(table, `a${account.id}`), 0, table)
  })
})
