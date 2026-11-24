import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { startHousehold } from './helpers/household-env.ts'

// A person's name, colour and photo are their account's: the profile it gets in any household wears them.

const NOW = Date.UTC(2026, 10, 20, 9)
const photo = { data: Buffer.from([1, 2, 3]), type: 'image/webp' as const }

describe('a person’s name, colour and photo', () => {
  it('follow the account from one profile to the next', () => {
    const db = openDatabase(':memory:')
    const profiles = new ProfileStore(db)
    const accounts = new UserAccountStore(db)
    const sam = profiles.create('Sam', 'tech', NOW)!
    const account = accounts.create('sam@example.com', 'unused-hash', NOW)!
    assert.equal(accounts.identityOf(account.id), null)

    // Linked, the account takes its profile's; changed on the profile, the account's change too.
    accounts.linkProfile(account.id, sam.id)
    assert.deepEqual(accounts.identityOf(account.id), { name: 'Sam', color: 'tech' })
    profiles.update(sam.id, { name: 'Samuel', color: 'ai' })
    profiles.setPhoto(sam.id, photo, NOW)
    assert.deepEqual(accounts.identityOf(account.id), { name: 'Samuel', color: 'ai' })

    // Its profile gone, the next one wears them, whatever it was made with.
    profiles.delete(sam.id)
    const again = profiles.create('Quelqu’un', 'sport', NOW)!
    accounts.linkProfile(account.id, again.id)
    const worn = profiles.get(again.id)!
    assert.deepEqual([worn.name, worn.color, worn.photoVersion], ['Samuel', 'ai', NOW])
    assert.deepEqual(profiles.photo(again.id), photo)
  })

  // An invitation code only ever makes a new account: an e-mail that has one signs in instead, its account untouched.
  it('refuses a code to an e-mail that already has an account', async () => {
    const env = await startHousehold()
    try {
      const before = await env.accounts.byEmail('sam@example.com')
      const { code } = (await (await env.call('/codes', env.admin, 'POST', {})).json()) as { code: string }
      const joined = await env.call('/codes/join', '', 'POST', {
        code,
        email: 'sam@example.com',
        password: 'another-password-1',
        ageConfirmed: true,
        profile: { name: 'Sam', color: 'world' }
      })
      assert.deepEqual([joined.status, await joined.json()], [409, { error: 'email_taken' }])
      assert.equal(joined.headers.getSetCookie().length, 0)
      assert.equal((await env.accounts.byEmail('sam@example.com'))?.passwordHash, before?.passwordHash)
      // The code was not spent on it.
      const again = await env.call('/codes/join', '', 'POST', {
        code,
        email: 'zoe@example.com',
        password: 'another-password-1',
        ageConfirmed: true,
        profile: { name: 'Zoé', color: 'science' }
      })
      assert.equal(again.status, 200)
    } finally {
      env.close()
    }
  })
})
