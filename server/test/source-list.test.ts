import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { loadCatalog } from '../news/catalog.ts'
import { sourceListMarkdown } from '../news/source-list.ts'

test('docs/source-list.md matches sources.yml', () => {
  const written = readFileSync(path.resolve('docs/source-list.md'), 'utf8')
  const expected = sourceListMarkdown(loadCatalog(path.resolve('sources.yml')))
  assert.equal(written, expected, 'sources.yml changed: run `npm run sources:list` and commit docs/source-list.md')
})
