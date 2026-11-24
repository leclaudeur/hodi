import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { asReaders } from '../db/reader-scope.ts'
import { UserAccountStore } from '../db/user-account-store.ts'

const NOW = Date.UTC(2026, 10, 24, 9)

// What a request sees of the profiles follows the accounts it reads as, and a request that names none sees none.
describe('the profiles a request reads', () => {
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  const own = (email: string, name: string) => {
    const account = accounts.create(email, 'unused-hash', NOW)!
    const profile = profiles.create(name, 'world', NOW)!
    accounts.linkProfile(account.id, profile.id)
    return { account, profile }
  }
  const claire = own('claire@example.com', 'Claire')
  const marc = own('marc@example.com', 'Marc')
  const names = () => profiles.list().map(profile => profile.name)

  it('are the accounts’ own only', () => {
    assert.deepEqual(asReaders([marc.account.id], names), ['Marc'])
    assert.deepEqual(asReaders([claire.account.id, marc.account.id], names), ['Claire', 'Marc'])
    assert.equal(
      asReaders([marc.account.id], () => profiles.get(claire.profile.id)),
      null
    )
  })

  // The API runs every request as nobody until its session names its accounts: a route that forgets to sign in
  // gets an empty list, never every profile.
  it('are none for a request signed in with nothing', () => {
    assert.deepEqual(asReaders([], names), [])
    assert.equal(
      asReaders([], () => profiles.get(marc.profile.id)),
      null
    )
    // find() is what crosses accounts on purpose: a code's profile, a share's sender.
    assert.equal(asReaders([], () => profiles.find(marc.profile.id))?.name, 'Marc')
  })

  // The install's first profile, which no account has yet, is there too.
  it('are every one outside a request, for the nightly jobs', () => {
    assert.deepEqual(names(), ['Admin', 'Claire', 'Marc'])
  })
})
