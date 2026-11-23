import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { SAM_PASSWORD, cookiesFrom, startHousehold } from './helpers/household-env.ts'

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

  it('let an account whose profile went join again without saying who it is again', async () => {
    const env = await startHousehold()
    try {
      const before = env.profiles.get(env.samId)!
      // As Réglages › Profils › « Supprimer » does; leaving the household on one's own is no longer a way.
      assert.ok(env.profiles.delete(env.samId))
      assert.equal((await env.call('/account/leave', env.sam, 'POST', { password: SAM_PASSWORD })).status, 404)
      const { code } = (await (await env.call('/codes', env.admin, 'POST', {})).json()) as { code: string }
      const joined = await env.call('/codes/join', '', 'POST', {
        code,
        existing: true,
        email: 'sam@example.com',
        password: SAM_PASSWORD
      })
      assert.equal(joined.status, 200)
      const { profileId } = (await joined.json()) as { profileId: number }
      const now = env.profiles.get(profileId)!
      assert.deepEqual([now.name, now.color], [before.name, before.color])
      assert.ok(cookiesFrom(joined))
    } finally {
      env.close()
    }
  })

  it('asks an account that was never in a household who it is first', async () => {
    const env = await startHousehold()
    try {
      env.accounts.create('zoe@example.com', (await env.accounts.byEmail('sam@example.com'))!.passwordHash, 0)
      const { code } = (await (await env.call('/codes', env.admin, 'POST', {})).json()) as { code: string }
      const join = (profile?: { name: string; color: string }) =>
        env.call('/codes/join', '', 'POST', {
          code,
          existing: true,
          email: 'zoe@example.com',
          password: SAM_PASSWORD,
          ...(profile ? { profile } : {})
        })
      const asked = await join()
      assert.deepEqual([asked.status, await asked.json()], [400, { error: 'profile_needed' }])
      const joined = await join({ name: 'Zoé', color: 'science' })
      assert.equal(joined.status, 200)
      const { profileId } = (await joined.json()) as { profileId: number }
      assert.equal(env.profiles.get(profileId)?.name, 'Zoé')
    } finally {
      env.close()
    }
  })
})
