import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CarriedSources } from '../db/carried-sources.ts'
import { openDatabase } from '../db/database.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SourceStore } from '../db/source-store.ts'
import { UserAccountStore } from '../db/user-account-store.ts'
import { UserStore } from '../db/user-store.ts'
import { carrySourcesOf } from '../app/carry-sources.ts'
import type { Options } from '../app/wiring.ts'
import { type Source, parseCatalog } from '../news/catalog.ts'
import { NewsService } from '../news/news-service.ts'
import { fakeFetch } from './helpers/news.ts'

// The sources an account had on go with it when its profile goes, and come back in the next household it joins.

const NOW = Date.UTC(2026, 10, 20, 9)
const site = (id: string, addedBy: number): Source & { addedBy: number } => ({
  id,
  name: `Site ${id}`,
  url: `https://${id}.example/feed`,
  kind: 'article',
  lang: 'fr',
  domains: [`${id}.example`],
  reader: true,
  skip: [],
  addedBy
})

const setup = () => {
  const db = openDatabase(':memory:')
  const profiles = new ProfileStore(db)
  const accounts = new UserAccountStore(db)
  const store = new SourceStore(db)
  const carried = new CarriedSources(db)
  const news = new NewsService(parseCatalog('topics:\n  - id: world\n    label: Monde\n    sources: []\n'), {
    fetchText: fakeFetch({}).fetchText,
    log: () => {}
  })
  const users = (id: number) => new UserStore(db, id)
  const add = (source: Source & { addedBy: number }) => {
    news.addSource(source, 'topic', ['world'])
    store.add(source, 'topic', ['world'], NOW)
  }
  // Sam, an adult with an account; the admin (profile 1) added x and w, Sam added y.
  const sam = profiles.create('Sam', 'tech', NOW)!
  const account = accounts.create('sam@example.com', 'unused-hash', NOW)!
  accounts.linkProfile(account.id, sam.id)
  add(site('x', 1))
  add(site('w', 1))
  add(site('y', sam.id))
  users(sam.id).setPreferences({ hiddenSources: ['w'] }, NOW)
  return { db, profiles, accounts, store, carried, news, users, sam, account }
}

describe('the sources an account carries', () => {
  it('are the added ones it had on, kept when its profile goes and taken once', () => {
    const { profiles, accounts, carried, sam, account } = setup()
    profiles.delete(sam.id)
    const again = profiles.create('Sam', 'tech', NOW)!
    accounts.linkProfile(account.id, again.id)
    assert.deepEqual(
      carried
        .take(again.id)
        .map(entry => [entry.source.id, entry.section, entry.sectionIds])
        .sort(),
      [
        ['x', 'topic', ['world']],
        ['y', 'topic', ['world']]
      ]
    )
    assert.deepEqual(carried.take(again.id), [])
  })

  it('come back on joining: followed again when missing, on for the account, off for the others', () => {
    const { profiles, accounts, store, carried, news, users, sam, account } = setup()
    profiles.delete(sam.id)
    // This household no longer follows y; it follows z, added by its admin since.
    store.remove('y')
    news.removeSource('y')
    news.addSource(site('z', 1), 'topic', ['world'])
    store.add(site('z', 1), 'topic', ['world'], NOW)

    const again = profiles.create('Sam', 'tech', NOW)!
    accounts.linkProfile(account.id, again.id)
    const options = { sources: { store, carried }, news, users, profiles, now: () => NOW } as unknown as Options
    const hide = (id: number, ids: string[]) =>
      users(id).setPreferences({ hiddenSources: [...users(id).hiddenSources(), ...ids] }, NOW)
    carrySourcesOf(options, hide)(again.id)

    assert.equal(store.has('y'), true)
    assert.equal(news.getSourceStatuses().find(status => status.id === 'y')?.addedBy, again.id)
    assert.deepEqual(users(again.id).hiddenSources().sort(), ['w', 'z'])
    assert.ok(users(1).hiddenSources().includes('y'))
  })
})
