import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { migrate } from '../db/migrations.ts'
import { MAX_PROFILES, ProfileStore, cleanName } from '../db/profile-store.ts'
import { MAX_READ, UserStore } from '../db/user-store.ts'

const NOW = Date.UTC(2026, 9, 25, 12)
const item = (id: string) => ({ id, title: `Article ${id}` })
const reading = (id: string, at = NOW) => ({
  id,
  sourceId: 'alpha',
  sourceName: 'Alpha',
  topicId: 'world',
  minutes: 3,
  at,
  kind: 'article' as const
})

describe('profiles', () => {
  it('gives everything kept before profiles to the first one', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    // The schema as it was before profiles, with a reader's state in it.
    migrate(db, 6)
    db.prepare("INSERT INTO user_settings (key, value, updated_at) VALUES ('preferences', ?, ?)").run(
      JSON.stringify({ theme: 'light' }),
      NOW
    )
    db.prepare("INSERT INTO user_settings (key, value, updated_at) VALUES ('revision', '7', ?)").run(NOW)
    db.prepare('INSERT INTO saved_articles (article_id, item, article, saved_at) VALUES (?, ?, NULL, ?)').run(
      'a',
      JSON.stringify(item('a')),
      NOW
    )
    db.prepare('INSERT INTO read_articles (article_id, read_at, hidden) VALUES (?, ?, 1)').run('b', NOW)
    db.prepare(
      `INSERT INTO readings (article_id, source_id, source_name, topic_id, minutes, read_at, kind)
       VALUES ('b', 'alpha', 'Alpha', 'world', 3, ?, 'video')`
    ).run(NOW)
    db.prepare('INSERT INTO push_subscriptions (endpoint, settings, updated_at) VALUES (?, ?, ?)').run(
      'https://push.example/1',
      JSON.stringify({ target: { endpoint: 'https://push.example/1' } }),
      NOW
    )

    migrate(db)

    const profiles = new ProfileStore(db).list()
    assert.deepEqual(profiles, [
      {
        id: 1,
        name: 'Admin',
        color: 'world',
        role: 'admin',
        kind: 'adult',
        avatar: null,
        photoVersion: null,
        tourPending: false,
        hasAccount: false
      }
    ])
    const state = new UserStore(db).getState()
    assert.equal(state.revision, 7)
    assert.deepEqual(state.preferences, { theme: 'light' })
    assert.deepEqual(
      state.saved.map(entry => entry.item.id),
      ['a']
    )
    assert.deepEqual(state.read, ['b'])
    assert.deepEqual(state.hidden, ['b'])
    assert.deepEqual(
      state.readings.map(entry => [entry.id, entry.kind]),
      [['b', 'video']]
    )
    assert.equal(new UserStore(db).listPushSubscriptions().length, 1)
  })

  it('keeps each profile’s state apart', () => {
    const db = openDatabase(':memory:')
    const second = new ProfileStore(db).create('Léa', 'science', NOW)
    assert.ok(second)
    const antho = new UserStore(db)
    const lea = new UserStore(db, second.id)

    antho.save(item('a'), null, NOW, NOW)
    antho.markRead(['a'], NOW)
    antho.addReadings([reading('a')], NOW)
    antho.setPreferences({ theme: 'light' }, NOW)
    lea.save(item('b'), null, NOW, NOW)

    assert.deepEqual(
      antho.getState().saved.map(entry => entry.item.id),
      ['a']
    )
    assert.deepEqual(
      lea.getState().saved.map(entry => entry.item.id),
      ['b']
    )
    assert.deepEqual(lea.getState().read, [])
    assert.deepEqual(lea.getState().readings, [])
    assert.equal(lea.getState().preferences, null)
    // Each has its own revision: a change on one sends no other device of the other fetching.
    assert.equal(antho.revision, 4)
    assert.equal(lea.revision, 1)
    assert.equal(lea.isSaved('a'), false)

    // The same article saved twice: once for each.
    lea.save(item('a'), null, NOW, NOW)
    antho.unsave('a', NOW)
    assert.equal(lea.isSaved('a'), true)

    lea.clearRead(NOW)
    lea.clearReadings(NOW)
    assert.deepEqual(antho.getState().read, ['a'])
    assert.equal(antho.getState().readings.length, 1)
  })

  it('knows when each profile first read, for "Peu ouvertes"', () => {
    const db = openDatabase(':memory:')
    const second = new ProfileStore(db).create('Léa', 'science', NOW)
    assert.ok(second)
    const antho = new UserStore(db)
    antho.addReadings([reading('a', NOW - 5000), reading('b')], NOW)
    assert.equal(antho.firstReadingAt(), NOW - 5000)
    assert.equal(new UserStore(db, second.id).firstReadingAt(), null)
  })

  it('caps each profile’s reads on its own', () => {
    const db = openDatabase(':memory:')
    const second = new ProfileStore(db).create('Léa', 'science', NOW)
    assert.ok(second)
    const antho = new UserStore(db)
    const lea = new UserStore(db, second.id)
    antho.markRead(
      Array.from({ length: MAX_READ + 5 }, (_, index) => `a${index}`),
      NOW
    )
    lea.markRead(['b'], NOW - 1)

    antho.prune(NOW)
    assert.equal(antho.getState().read.length, MAX_READ)
    assert.deepEqual(lea.getState().read, ['b'])
  })

  it('makes up to five profiles, and never deletes the last one', () => {
    const db = openDatabase(':memory:')
    const profiles = new ProfileStore(db)
    for (let count = 2; count <= MAX_PROFILES; count++) assert.ok(profiles.create(`Profil ${count}`, 'tech', NOW))
    assert.equal(profiles.create('Un de trop', 'tech', NOW), null)
    assert.equal(profiles.list().length, MAX_PROFILES)

    const last = profiles.list().at(-1)!
    assert.deepEqual(profiles.update(last.id, { name: 'Sam', color: 'ai' }), { ...last, name: 'Sam', color: 'ai' })

    profiles
      .list()
      .slice(1)
      .forEach(profile => assert.equal(profiles.delete(profile.id), true))
    assert.equal(profiles.delete(1), false)
    assert.equal(profiles.list().length, 1)
  })

  it('takes a profile’s state away with it', () => {
    const db = openDatabase(':memory:')
    const profiles = new ProfileStore(db)
    const lea = profiles.create('Léa', 'science', NOW)!
    const state = new UserStore(db, lea.id)
    state.save(item('a'), null, NOW, NOW)
    state.markRead(['a'], NOW)

    profiles.delete(lea.id)
    for (const table of ['saved_articles', 'read_articles', 'profile_settings']) {
      const { count } = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE profile_id = ?`).get(lea.id) as {
        count: number
      }
      assert.equal(count, 0, table)
    }
  })

  it('keeps a photo, and goes back to the initial without one', () => {
    const db = openDatabase(':memory:')
    const profiles = new ProfileStore(db)
    const photo = { data: Buffer.from([1, 2, 3]), type: 'image/webp' as const }

    assert.equal(profiles.setPhoto(1, photo, NOW)?.photoVersion, NOW)
    assert.deepEqual(profiles.photo(1), photo)
    assert.equal(profiles.setPhoto(1, null, NOW)?.photoVersion, null)
    assert.equal(profiles.photo(1), null)
  })

  it('gives each child an avatar no other profile wears, and drops what a young profile may not keep', () => {
    const db = openDatabase(':memory:')
    const profiles = new ProfileStore(db)
    const max = profiles.create('Max', 'sport', NOW, { kind: 'child' })!
    assert.equal(max.kind, 'child')
    assert.equal(max.avatar, 'fox')
    assert.equal(profiles.create('Zoé', 'ai', NOW, { kind: 'child' })!.avatar, 'pirate')
    assert.equal(profiles.create('Léo', 'tech', NOW, { kind: 'child', avatar: 'owl' })!.avatar, 'owl')
    assert.equal(profiles.create('Lou', 'tech', NOW, { kind: 'teen', avatar: 'owl' })!.avatar, null)

    // An adult with a photo becomes a child: it does not stay.
    const sam = profiles.list().find(profile => profile.name === 'Lou')!
    profiles.update(sam.id, { kind: 'adult' })
    profiles.setPhoto(sam.id, { data: Buffer.from([1]), type: 'image/webp' }, NOW)
    const child = profiles.update(sam.id, { kind: 'child' })!
    assert.equal(child.photoVersion, null)
    assert.equal(child.avatar, 'astronaut')
    assert.equal(profiles.update(sam.id, { kind: 'teen' })!.avatar, null)

    // The admin stays an adult.
    assert.equal(profiles.update(1, { kind: 'child' })!.kind, 'adult')
  })

  it('takes a name as typed, within its length', () => {
    assert.equal(cleanName('  Léa   M. '), 'Léa M.')
    assert.equal(cleanName('   '), null)
    assert.equal(cleanName('x'.repeat(25)), null)
    assert.equal(cleanName(3), null)
  })
})
