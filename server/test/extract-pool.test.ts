import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { extractArticle } from '../news/extract.ts'
import { createExtractPool } from '../news/extract-pool.ts'

const paragraph = (index: number) =>
  `<p>Paragraphe ${index}. La rédaction a suivi la journée de près et revient sur ce qui s’est passé, avec les ` +
  'réactions des habitants, des commerçants et des élus, et ce qui est prévu pour la suite.</p>'

const page =
  '<!doctype html><html lang="fr"><head><title>Pluie record</title><meta property="og:image" content="/photo.jpg">' +
  `</head><body><main><article><h1>Pluie record</h1>${Array.from({ length: 8 }, (_, index) => paragraph(index)).join('')}` +
  '</article></main></body></html>'

describe('createExtractPool', () => {
  const pool = createExtractPool()
  after(() => pool.close())

  it('extracts on its own thread the same text as on the main one', async () => {
    const url = 'https://alpha.example/pluie'
    const extracted = await pool.extract(page, url)

    assert.ok(extracted)
    assert.deepEqual(extracted, extractArticle(page, url))
    assert.equal(extracted.image, 'https://alpha.example/photo.jpg')
  })

  it('answers null for a page with no article, as the main thread does', async () => {
    assert.equal(
      await pool.extract('<html><body><p>Accepte les cookies.</p></body></html>', 'https://a.example/'),
      null
    )
  })
})
