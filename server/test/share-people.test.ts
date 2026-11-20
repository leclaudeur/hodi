import assert from 'node:assert/strict'
import type express from 'express'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserStore } from '../db/user-store.ts'
import { sharePeople } from '../http/share-people.ts'

const NOW = Date.UTC(2026, 10, 20, 12)

// Who shares with whom once there is no household: Antho and Sophie, parents of Max (8); Paul, another adult on the
// server, father of Lina (12).
const server = () => {
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  const adult = (name: string, handle: string) => {
    const account = accounts.create(`${handle}@example.com`, 'hash', NOW)!
    db.prepare('UPDATE users SET handle = ? WHERE id = ?').run(handle, account.id)
    const profile = name === 'Antho' ? profiles.update(1, { name })! : profiles.create(name, 'tech', NOW)!
    accounts.linkProfile(account.id, profile.id)
    return { account: accounts.get(account.id)!, profile: profiles.get(profile.id)! }
  }
  const antho = adult('Antho', 'antho')
  const sophie = adult('Sophie', 'sophie')
  const paul = adult('Paul', 'paul')
  const young = (name: string, handle: string, parentId: number) => {
    const made = accounts.young.create(profiles, parentId, { name, color: 'sport', kind: 'child', handle }, NOW)!
    return { accountId: made.accountId, profile: profiles.get(made.profileId)! }
  }
  const max = young('Max', 'max', antho.account.id)
  db.prepare('INSERT INTO account_parents (child_id, parent_id, created_at) VALUES (?, ?, ?)').run(
    max.accountId,
    sophie.account.id,
    NOW
  )
  const lina = young('Lina', 'lina', paul.account.id)
  const users = (profileId: number) => new UserStore(db, profileId)
  let here: number[] = []
  const people = sharePeople({ users, profiles, accounts, signedInHere: () => here })
  const request = {} as express.Request
  const offered = (from: { profile: { id: number } }) =>
    people.offered(profiles.get(from.profile.id)!, request).map(profile => profile.name)
  const signIn = (...ids: number[]) => {
    here = ids
  }
  return { people, profiles, users, offered, signIn, antho, sophie, paul, max, lina }
}

describe('sharing between accounts', () => {
  it('offers the family at once, and lets two adults find each other by their username', () => {
    const { people, offered, antho, sophie, paul } = server()
    assert.deepEqual(offered(antho), ['Sophie', 'Max'])
    assert.deepEqual(offered(paul), ['Lina'])
    assert.equal(people.byHandle(paul.profile, '@antho')?.name, 'Antho')
    assert.equal(people.byHandle(antho.profile, 'PAUL')?.name, 'Paul')
    assert.equal(people.byHandle(antho.profile, 'personne'), null)
    assert.ok(people.mayShare(sophie.profile, paul.profile))
  })

  it('keeps a teen or a child to its family, both ways', () => {
    const { people, offered, max, lina, paul, antho } = server()
    assert.deepEqual(offered(max), ['Antho', 'Sophie'])
    assert.equal(people.mayShare(max.profile, paul.profile), false)
    assert.equal(people.mayShare(paul.profile, max.profile), false)
    assert.equal(people.byHandle(paul.profile, 'max'), null)
    assert.equal(people.byHandle(antho.profile, 'lina'), null)
    assert.ok(people.mayShare(paul.profile, lina.profile))
  })

  it('keeps a teen or a child away from a profile with no account yet, which still shares with the adults', () => {
    const { people, profiles, max, paul, lina } = server()
    // Room for one more profile: five at most.
    profiles.delete(lina.profile.id)
    const before = profiles.create('Mamie', 'music', NOW)!
    assert.equal(people.mayShare(max.profile, before), false)
    assert.equal(people.mayShare(before, max.profile), false)
    assert.ok(people.mayShare(paul.profile, before))
    assert.ok(people.mayShare(before, paul.profile))
  })

  it('offers the accounts signed in on this device and whoever shared lately', () => {
    const { offered, signIn, users, antho, paul } = server()
    signIn(antho.account.id, paul.account.id)
    assert.deepEqual(offered(paul), ['Antho', 'Lina'])
    signIn()
    users(antho.profile.id).shareTo(paul.profile.id, { id: 'a' }, NOW)
    assert.deepEqual(offered(paul), ['Antho', 'Lina'])
    assert.deepEqual(offered(antho), ['Sophie', 'Paul', 'Max'])
  })

  it('never offers or reaches someone who turned sharing off, or turned this one off', () => {
    const { people, offered, users, antho, sophie } = server()
    users(sophie.profile.id).setPreferences({ sharing: false }, NOW)
    assert.deepEqual(offered(antho), ['Max'])
    users(sophie.profile.id).setPreferences({ sharing: true, mutedSharers: [antho.profile.id] }, NOW)
    assert.equal(people.mayShare(antho.profile, sophie.profile), false)
    assert.ok(people.mayShare(sophie.profile, antho.profile))
  })
})
