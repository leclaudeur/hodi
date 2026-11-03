import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SHARES_RETENTION_MS, UserStore } from '../db/user-store.ts'

const NOW = Date.UTC(2026, 9, 27, 12)

describe('Partages', () => {
  it('keeps what was sent to a profile for a week, newest first, without what it put away', () => {
    const db = openDatabase(':memory:')
    const second = new ProfileStore(db).create('Léa', 'science', NOW)
    assert.ok(second)
    const antho = new UserStore(db)
    const lea = new UserStore(db, second.id)

    antho.shareTo(second.id, { id: 'older', title: 'Plus ancien' }, NOW - 2000)
    antho.shareTo(second.id, { id: 'newer', title: 'Plus récent' }, NOW - 1000)
    antho.shareTo(second.id, { id: 'hidden', title: 'Masqué' }, NOW)
    lea.markRead(['hidden'], NOW, true)
    // Sent again: back on top.
    antho.shareTo(second.id, { id: 'older', title: 'Plus ancien' }, NOW + 1000)

    assert.deepEqual(
      lea.shares(NOW - SHARES_RETENTION_MS).map(share => [share.item.id, share.from]),
      [
        ['older', 1],
        ['newer', 1]
      ]
    )
    assert.deepEqual(antho.shares(NOW - SHARES_RETENTION_MS), [])

    lea.prune(NOW + SHARES_RETENTION_MS + 1500)
    assert.deepEqual(lea.shares(0), [])
  })

  it('drops a share once it is read: clearing the history does not bring it back, a new share does', () => {
    const db = openDatabase(':memory:')
    const second = new ProfileStore(db).create('Léa', 'science', NOW)
    assert.ok(second)
    const antho = new UserStore(db)
    const lea = new UserStore(db, second.id)

    antho.shareTo(second.id, { id: 'read', title: 'Lu' }, NOW)
    antho.shareTo(second.id, { id: 'left', title: 'Pas lu' }, NOW)
    lea.markRead(['read'], NOW + 1000)
    lea.clearRead(NOW + 2000)
    assert.deepEqual(
      lea.shares(0).map(share => share.item.id),
      ['left']
    )

    antho.shareTo(second.id, { id: 'read', title: 'Lu' }, NOW + 3000)
    assert.deepEqual(
      lea.shares(0).map(share => share.item.id),
      ['read', 'left']
    )
  })

  it('keeps the word sent with a share, replaced when it is sent again', () => {
    const db = openDatabase(':memory:')
    const second = new ProfileStore(db).create('Léa', 'science', NOW)
    assert.ok(second)
    const antho = new UserStore(db)
    const lea = new UserStore(db, second.id)

    antho.shareTo(second.id, { id: 'a', title: 'A' }, NOW, 'Regarde ça pour samedi')
    antho.shareTo(second.id, { id: 'b', title: 'B' }, NOW - 1000)
    assert.deepEqual(
      lea.shares(0).map(share => [share.item.id, share.note]),
      [
        ['a', 'Regarde ça pour samedi'],
        ['b', null]
      ]
    )

    antho.shareTo(second.id, { id: 'a', title: 'A' }, NOW + 1000)
    assert.equal(lea.shares(0)[0]?.note, null)
  })

  it('lets the reader of a share react, even once read; its sender sees the reaction once', () => {
    const db = openDatabase(':memory:')
    const second = new ProfileStore(db).create('Léa', 'science', NOW)
    assert.ok(second)
    const antho = new UserStore(db)
    const lea = new UserStore(db, second.id)

    antho.shareTo(second.id, { id: 'a', title: 'A' }, NOW)
    lea.markRead(['a'], NOW + 1000)
    assert.deepEqual(lea.shares(0), [])

    assert.equal(lea.react('a', 1, '❤️', NOW + 2000)?.changed, true)
    assert.equal(lea.react('a', 1, '❤️', NOW + 2500)?.changed, false)
    assert.equal(lea.react('a', 2, '❤️', NOW + 2500), null)
    assert.equal(lea.react('missing', 1, '❤️', NOW + 2500), null)
    assert.deepEqual(antho.reactions(), [
      { item: { id: 'a', title: 'A' }, to: second.id, reaction: '❤️', reactedAt: NOW + 2000 }
    ])

    antho.markReactionsSeen(NOW + 2000)
    assert.deepEqual(antho.reactions(), [])

    // Changed: shown again. Taken back: nothing to show.
    lea.react('a', 1, '😂', NOW + 3000)
    assert.equal(antho.reactions()[0]?.reaction, '😂')
    lea.react('a', 1, null, NOW + 4000)
    assert.deepEqual(antho.reactions(), [])

    // Sent again: unread, without the old reaction.
    lea.react('a', 1, '👍', NOW + 5000)
    antho.shareTo(second.id, { id: 'a', title: 'A' }, NOW + 6000)
    assert.deepEqual(
      lea.shares(0).map(share => [share.item.id, share.reaction]),
      [['a', null]]
    )
    assert.deepEqual(antho.reactions(), [])
  })
})
