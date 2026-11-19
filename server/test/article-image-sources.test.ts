import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import sharp from 'sharp'
import { openDatabase } from '../db/database.ts'
import { ImageStore } from '../db/image-store.ts'
import { ArticleImages } from '../news/article-images.ts'
import type { FetchBytes } from '../news/fetch-text.ts'

const NOW = Date.UTC(2026, 10, 1)

const picture = (width: number) =>
  sharp({ create: { width, height: Math.round((width * 9) / 16), channels: 3, background: '#c8502a' } })
    .jpeg()
    .toBuffer()

// 7sur7 puts a 400-pixel picture in its feed; an article page's share picture is often 1600.
const small = await picture(400)
const large = await picture(1600)

const setup = (pictures: Record<string, Buffer>) => {
  const db = openDatabase(':memory:')
  const insert = db.prepare(
    `INSERT INTO articles (id, source_id, source_name, kind, lang, title, summary, link, image, page_image,
       first_seen_at, last_seen_at)
     VALUES (?, ?, 'BX1', 'article', 'fr', 'Titre', '', ?, ?, ?, ?, ?)`
  )
  const article = (id: string, image: string | null, pageImage: string | null, sourceId = 'bx1') =>
    insert.run(id, sourceId, `https://bx1.be/${id}`, image, pageImage, NOW, NOW)
  // The page's share picture, known once the reader checked the page.
  const pageFound = (id: string, pageImage: string) =>
    db.prepare('UPDATE articles SET page_image = ? WHERE id = ?').run(pageImage, id)
  const fetched: string[] = []
  const fetchBytes: FetchBytes = async url => {
    fetched.push(url)
    const bytes = pictures[url]
    if (!bytes) throw new Error('HTTP 404')
    return { url, bytes }
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'hodi-image-sources-'))
  const store = new ImageStore(db)
  const images = new ArticleImages({ store, fetchBytes, dir, now: () => NOW, log: () => {}, sharp })
  const widthOf = async (id: string) => (await sharp((await images.file(id, 960)) ?? '').metadata()).width
  return { article, pageFound, fetched, store, images, widthOf }
}

describe('article picture sources', () => {
  it('makes the copies from the page’s share picture when the feed’s is narrower', async () => {
    const { article, fetched, store, widthOf } = setup({
      'https://bx1.be/small.jpg': small,
      'https://bx1.be/share.jpg': large
    })
    article('aaaaaaaaaaaaaaaa', 'https://bx1.be/small.jpg', 'https://bx1.be/share.jpg')

    assert.equal(await widthOf('aaaaaaaaaaaaaaaa'), 960)
    assert.deepEqual(fetched, ['https://bx1.be/small.jpg', 'https://bx1.be/share.jpg'])
    assert.equal(store.get('aaaaaaaaaaaaaaaa')?.failed, false)
  })

  it('never downloads the page’s picture when the feed’s is wide enough', async () => {
    const { article, fetched, images, widthOf } = setup({
      'https://bx1.be/large.jpg': large,
      'https://bx1.be/share.jpg': large
    })
    article('bbbbbbbbbbbbbbbb', 'https://bx1.be/large.jpg', 'https://bx1.be/share.jpg')

    assert.equal(await widthOf('bbbbbbbbbbbbbbbb'), 960)
    await images.warm()
    assert.deepEqual(fetched, ['https://bx1.be/large.jpg'])
  })

  it('keeps the feed’s picture when the page’s is not sharper or fails', async () => {
    const { article, widthOf } = setup({ 'https://bx1.be/small.jpg': small, 'https://bx1.be/tiny.jpg': small })
    article('cccccccccccccccc', 'https://bx1.be/small.jpg', 'https://bx1.be/missing.jpg')
    article('dddddddddddddddd', 'https://bx1.be/small.jpg', 'https://bx1.be/tiny.jpg')

    assert.equal(await widthOf('cccccccccccccccc'), 400)
    assert.equal(await widthOf('dddddddddddddddd'), 400)
  })

  it('uses the page’s picture when the feed’s cannot be downloaded', async () => {
    const { article, widthOf } = setup({ 'https://bx1.be/share.jpg': large })
    article('eeeeeeeeeeeeeeee', 'https://bx1.be/missing.jpg', 'https://bx1.be/share.jpg')

    assert.equal(await widthOf('eeeeeeeeeeeeeeee'), 960)
  })

  it('ignores a page picture that other articles of the source share: a logo, not the article’s', async () => {
    const { article, fetched, widthOf } = setup({
      'https://bx1.be/small.jpg': small,
      'https://bx1.be/logo.png': large
    })
    article('ffffffffffffffff', 'https://bx1.be/small.jpg', 'https://bx1.be/logo.png')
    article('gggggggggggggggg', null, 'https://bx1.be/logo.png')

    assert.equal(await widthOf('ffffffffffffffff'), 400)
    assert.deepEqual(fetched, ['https://bx1.be/small.jpg'])
  })

  it('makes a small feed picture again once its page’s share picture is known, and only once', async () => {
    const { article, pageFound, fetched, images, widthOf } = setup({
      'https://bx1.be/small.jpg': small,
      'https://bx1.be/share.jpg': large
    })
    article('hhhhhhhhhhhhhhhh', 'https://bx1.be/small.jpg', null)
    await images.warm()
    assert.equal(await widthOf('hhhhhhhhhhhhhhhh'), 400)

    pageFound('hhhhhhhhhhhhhhhh', 'https://bx1.be/share.jpg')
    await images.warm()
    assert.equal(await widthOf('hhhhhhhhhhhhhhhh'), 960)

    await images.warm()
    assert.deepEqual(fetched, ['https://bx1.be/small.jpg', 'https://bx1.be/small.jpg', 'https://bx1.be/share.jpg'])
  })
})
