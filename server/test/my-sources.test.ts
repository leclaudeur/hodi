import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { onSetUpOf } from '../app/household-options.ts'
import type { Options } from '../app/wiring.ts'
import { openDatabase } from '../db/database.ts'
import { migrate, versionBefore } from '../db/migrations.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { UserStore } from '../db/user-store.ts'
import { parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { addMySources, mySources, readerCounts, removeMySource, sourcesOff, withSourcesOff } from '../db/my-sources.ts'

const MIGRATION = 'CREATE TABLE my_sources'

// A household as it was: Alex (an account) turned France 24 off, Kim (a profile with no account) turned nothing off.
const before = () => {
  const db = new DatabaseSync(':memory:')
  migrate(db, versionBefore(MIGRATION))
  db.exec(`
    DELETE FROM profiles;
    INSERT INTO users (id, email, password_hash, password_changed_at, created_at, name)
      VALUES (1, 'alex@example.com', 'x', 0, 0, 'Alex');
    INSERT INTO profiles (id, account_id, name, color, position, created_at, user_id, kind) VALUES
      (10, 1, 'Alex', 'tech', 0, 0, 1, 'adult'),
      (12, 1, 'Kim', 'sport', 1, 0, NULL, 'adult');
    INSERT INTO sources (id, section, section_id, position, name, url, kind, lang, domains, reader, skip, created_at)
      VALUES ('rtl', 'topic', 'belgium', 0, 'RTL', 'https://rtl.test/rss', 'article', 'fr', '[]', 1, '[]', 0),
             ('f24', 'topic', 'world', 1, 'France 24', 'https://f24.test/rss', 'article', 'fr', '[]', 1, '[]', 0);
    INSERT INTO household_sources (household_id, source_id, section, section_id, position, created_at)
      VALUES (1, 'rtl', 'topic', 'belgium', 0, 5), (1, 'f24', 'topic', 'world', 1, 6);
    INSERT INTO profile_settings (owner, key, value, updated_at) VALUES
      ('a1', 'preferences', '{"theme":"dark","hiddenSources":["f24"]}', 0);
  `)
  migrate(db)
  return db
}

describe('« Mes sources »', () => {
  it('keeps the sources each person read, and drops the old list of sources turned off', () => {
    const db = before()
    assert.deepEqual(mySources(db, 'a1'), ['rtl'])
    assert.deepEqual(mySources(db, 'p12').sort(), ['f24', 'rtl'])
    const preferences = db.prepare(`SELECT value FROM profile_settings WHERE owner = 'a1'`).get() as { value: string }
    assert.deepEqual(JSON.parse(preferences.value), { theme: 'dark' })
    // The app still reads the rest of the catalogue as hidden.
    assert.deepEqual(sourcesOff(db, 'a1', 10), ['f24'])
    assert.deepEqual(sourcesOff(db, 'p12', 12), [])
    assert.deepEqual(withSourcesOff({ theme: 'dark' }, ['f24']), { theme: 'dark', hiddenSources: ['f24'] })
    assert.deepEqual(withSourcesOff({ theme: 'dark' }, []), { theme: 'dark' })
  })

  it('adds and removes, counting only what changed', () => {
    const db = before()
    assert.equal(addMySources(db, 'a1', ['rtl', 'f24'], 9), 1)
    assert.equal(removeMySource(db, 'a1', 'f24'), true)
    assert.equal(removeMySource(db, 'a1', 'f24'), false)
  })

  it('goes with the account, and follows a profile that gets one', () => {
    const db = before()
    db.exec(`INSERT INTO users (id, email, password_hash, password_changed_at, created_at, name, color)
      VALUES (2, 'kim@example.com', 'x', 0, 0, 'Kim', 'sport')`)
    db.exec('UPDATE profiles SET user_id = 2 WHERE id = 12')
    assert.deepEqual(mySources(db, 'p12'), [])
    assert.deepEqual(mySources(db, 'a2').sort(), ['f24', 'rtl'])
    db.exec('DELETE FROM users WHERE id = 1')
    assert.deepEqual(mySources(db, 'a1'), [])
    assert.deepEqual([...readerCounts(db)].sort(), [
      ['f24', 1],
      ['rtl', 1]
    ])
  })
})

describe('« Mes sources » at setup', () => {
  it('gives the first adult the base sources once the catalogue is filled in the household’s language', () => {
    const db = openDatabase(':memory:')
    const profiles = new ProfileStore(db)
    const claire = profiles.create('Claire', 'tech', 0)!
    const users = (id: number) => new UserStore(db, id)
    const file = parseCatalog(`topics:
  - id: monde
    label: Monde
    sources:
      - id: rtl
        name: RTL info
        url: https://rtl.example/feed
        domains: [rtl.example]
        base: [fr]
      - id: bbc
        name: BBC
        url: https://bbc.example/feed
        domains: [bbc.example]
        lang: en
        base: [en]
`)
    const news = new NewsService(parseCatalog('topics:\n  - id: monde\n    label: Monde\n    sources: []\n'), {
      fetchText: async () => '',
      log: () => {}
    })
    const options = { sources: { store: new SourceStore(db), file }, news, profiles, users, now: () => 5 }
    onSetUpOf(options as unknown as Options)('fr', null)
    assert.deepEqual(users(claire.id).sources.mine(), ['rtl'])
  })
})
