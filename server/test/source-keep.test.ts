import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openDatabase } from '../db/database.ts'
import { ProfileStore } from '../db/profile-store.ts'
import { SourceStore } from '../db/source-store.ts'
import type { Catalog, Source } from '../news/catalog.ts'
import { handOverInCatalog } from '../news/catalog-edits.ts'

// A source stays in its household when the profile that added it goes: the admin takes it on.

const NOW = Date.UTC(2026, 10, 20, 9)
const blog = (addedBy: number): Source & { addedBy: number } => ({
  id: `p${addedBy}-blog`,
  name: 'Le blog',
  url: `https://blog.example/${addedBy}/feed`,
  kind: 'article',
  lang: 'fr',
  domains: ['blog.example'],
  reader: true,
  skip: [],
  addedBy
})

const addedByOf = (db: ReturnType<typeof openDatabase>, id: string) =>
  (db.prepare('SELECT added_by FROM household_sources WHERE source_id = ?').get(id) as { added_by: number } | undefined)
    ?.added_by

describe('a source whose adder goes', () => {
  it('stays in the household, the admin’s now', () => {
    const db = openDatabase(':memory:')
    const profiles = new ProfileStore(db)
    const sources = new SourceStore(db)
    const lea = profiles.create('Léa', 'science', NOW)!
    sources.add(blog(lea.id), 'topic', ['world'], NOW)

    profiles.delete(lea.id)
    assert.equal(sources.has(`p${lea.id}-blog`), true)
    assert.equal(addedByOf(db, `p${lea.id}-blog`), 1)
  })

  it('goes with its household, which has no admin left to take it on', () => {
    const db = openDatabase(':memory:')
    const sources = new SourceStore(db)
    sources.add(blog(1), 'topic', ['world'], NOW)
    db.prepare('DELETE FROM accounts WHERE id = 1').run()
    assert.equal(addedByOf(db, 'p1-blog'), undefined)
  })

  it('is handed over in the catalogue the feeds are read from', () => {
    const source = blog(2)
    const catalog = { topics: [{ id: 'world', sources: [source] }], listen: [] } as unknown as Catalog
    handOverInCatalog(catalog, 2, 1)
    assert.equal(catalog.topics[0]!.sources[0]!.addedBy, 1)
  })
})
