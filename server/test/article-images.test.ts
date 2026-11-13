import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import sharp from 'sharp'
import { openDatabase } from '../db/database.ts'
import { ImageStore } from '../db/image-store.ts'
import { ArticleImages } from '../news/article-images.ts'
import { inlineImageSources, numberInlineImages } from '../news/inline-images.ts'
import type { FetchBytes } from '../news/fetch-text.ts'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 1)

// A 1600 × 900 JPEG, as a news site's share picture often is.
const photo = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 200, g: 80, b: 40 } } })
  .jpeg()
  .toBuffer()

const setup = (pictures: Record<string, Buffer>, slow?: Promise<void>) => {
  const db = openDatabase(':memory:')
  const insert = db.prepare(
    `INSERT INTO articles (id, source_id, source_name, kind, lang, title, summary, link, image, first_seen_at, last_seen_at)
     VALUES (?, 'bx1', 'BX1', 'article', 'fr', 'Titre', '', ?, ?, ?, ?)`
  )
  const article = (id: string, image: string | null, seenAt = NOW) =>
    insert.run(id, `https://bx1.be/${id}`, image, seenAt, seenAt)
  const text = (id: string, html: string) =>
    db
      .prepare(
        `INSERT INTO article_content (article_id, title, byline, content_html, text_length, image, extracted_at)
         VALUES (?, 'Titre', NULL, ?, 100, NULL, ?)`
      )
      .run(id, html, NOW)
  const fetched: string[] = []
  const fetchBytes: FetchBytes = async url => {
    fetched.push(url)
    // A site that is slow to answer, until the test lets it.
    if (slow && url.endsWith('/slow.jpg')) await slow
    const bytes = pictures[url]
    if (!bytes) throw new Error('HTTP 404')
    return { url, bytes }
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'hodi-images-'))
  const store = new ImageStore(db)
  const images = new ArticleImages({ store, fetchBytes, dir, now: () => NOW, log: () => {} })
  return { db, article, text, fetched, dir, store, images }
}

describe('article images', () => {
  it('makes three smaller WebP widths and a tiny preview, from one download', async () => {
    const { article, fetched, images } = setup({ 'https://bx1.be/photo.jpg': photo })
    article('aaaaaaaaaaaaaaaa', 'https://bx1.be/photo.jpg')

    const [small, large] = await Promise.all([
      images.file('aaaaaaaaaaaaaaaa', 240),
      images.file('aaaaaaaaaaaaaaaa', 960)
    ])
    assert.ok(small && large)
    const meta = await sharp(small).metadata()
    assert.equal(meta.format, 'webp')
    assert.equal(meta.width, 240)
    assert.equal(meta.height, 135)
    assert.equal((await sharp(large).metadata()).width, 960)
    assert.ok(await images.file('aaaaaaaaaaaaaaaa', 480))
    assert.deepEqual(fetched, ['https://bx1.be/photo.jpg'])

    const preview = images.preview('aaaaaaaaaaaaaaaa')
    assert.match(preview ?? '', /^data:image\/webp;base64,/)
    assert.ok((preview ?? '').length < 1000)
  })

  it('never makes a picture larger than its original', async () => {
    const tiny = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#336699' } })
      .png()
      .toBuffer()
    const { article, images } = setup({ 'https://bx1.be/tiny.png': tiny })
    article('bbbbbbbbbbbbbbbb', 'https://bx1.be/tiny.png')

    const file = await images.file('bbbbbbbbbbbbbbbb', 960)
    assert.equal((await sharp(file ?? '').metadata()).width, 300)
  })

  it('refuses a picture too large to decode in the container’s memory', async () => {
    // 5000 × 4000: 20 million pixels, 80 MB once decoded.
    const huge = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: '#336699' } })
      .png({ compressionLevel: 1 })
      .toBuffer()
    const { article, images, store } = setup({ 'https://bx1.be/huge.png': huge })
    article('kkkkkkkkkkkkkkkk', 'https://bx1.be/huge.png')

    assert.equal(await images.file('kkkkkkkkkkkkkkkk', 240), null)
    assert.equal(store.get('kkkkkkkkkkkkkkkk')?.failed, true)
  })

  it('answers nothing for an unknown width, an article without picture, or bytes that are not a picture', async () => {
    const { article, fetched, images, store } = setup({ 'https://bx1.be/page.html': Buffer.from('<html></html>') })
    article('cccccccccccccccc', 'https://bx1.be/page.html')
    article('dddddddddddddddd', null)

    assert.equal(await images.file('cccccccccccccccc', 500), null)
    assert.equal(await images.file('dddddddddddddddd', 240), null)
    assert.equal(await images.file('cccccccccccccccc', 240), null)
    assert.equal(store.get('cccccccccccccccc')?.failed, true)
    assert.equal(images.preview('cccccccccccccccc'), null)

    // A failed picture is not fetched again at every card.
    assert.equal(await images.file('cccccccccccccccc', 480), null)
    assert.deepEqual(fetched, ['https://bx1.be/page.html'])
  })

  it('answers nothing for a name that is not an article id, so no path leaves its folder', async () => {
    const { images } = setup({})
    assert.equal(await images.file('../../etc/passwd', 240), null)
    assert.equal(await images.inlineFile('../aaaaaaaaaaaaa', 0, 240), null)
  })

  it('makes the newest articles’ pictures in the background', async () => {
    const { article, images } = setup({ 'https://bx1.be/photo.jpg': photo })
    article('eeeeeeeeeeeeeeee', 'https://bx1.be/photo.jpg')
    article('ffffffffffffffff', 'https://bx1.be/photo.jpg', NOW - 10 * DAY)

    await images.warm()

    assert.ok(images.preview('eeeeeeeeeeeeeeee'))
    assert.equal(images.preview('ffffffffffffffff'), null)
  })

  it('makes every new article picture in the background, more than one batch, and each article once', async () => {
    const { article, fetched, images } = setup({ 'https://bx1.be/photo.jpg': photo })
    const ids = Array.from({ length: 25 }, (_, index) => `w${String(index).padStart(15, '0')}`)
    for (const id of ids) article(id, 'https://bx1.be/photo.jpg')
    article('wbroken000000000', 'https://bx1.be/missing.jpg')

    await images.warm()

    assert.ok(ids.every(id => images.preview(id)))
    assert.equal(fetched.length, 26)
  })

  it('does not keep a card waiting for a slow download made in the background', async () => {
    let answer = () => {}
    const slow = new Promise<void>(resolve => (answer = resolve))
    const { article, images } = setup({ 'https://bx1.be/photo.jpg': photo }, slow)
    // The background starts with the newest article, whose site is slow to answer.
    article('slowslowslowslow', 'https://bx1.be/slow.jpg', NOW)
    article('cardcardcardcard', 'https://bx1.be/photo.jpg', NOW - 1000)

    const warming = images.warm()
    assert.ok(await images.file('cardcardcardcard', 240))

    answer()
    await warming
    assert.equal(images.preview('slowslowslowslow'), null)
  })

  it('numbers the pictures of a text, and reads their addresses back in the same order', () => {
    const html =
      '<p>Un</p><figure><img src="https://bx1.be/a.jpg?w=1&amp;h=2" alt=""></figure><img alt="none"><IMG SRC=\'https://bx1.be/c.png\'>'
    assert.deepEqual(inlineImageSources(html), ['https://bx1.be/a.jpg?w=1&h=2', null, 'https://bx1.be/c.png'])
    assert.equal(
      numberInlineImages(html),
      '<p>Un</p><figure><img data-image="0" src="https://bx1.be/a.jpg?w=1&amp;h=2" alt=""></figure><img data-image="1" alt="none"><img data-image="2" SRC=\'https://bx1.be/c.png\'>'
    )
  })

  it('gives a picture inside a text the size of its copy, so the reader keeps its place', () => {
    const html =
      '<img src="a.jpg" width="100%" height=\'50\'><img width="686" height="577" src="b.jpg"><img src="c.jpg">'
    assert.equal(
      numberInlineImages(html, [{ width: 960, height: 540 }, null]),
      '<img data-image="0" width="960" height="540" src="a.jpg"><img data-image="1" width="686" height="577" src="b.jpg"><img data-image="2" src="c.jpg">'
    )
  })

  it('makes a picture inside a text smaller, by its number, once', async () => {
    const { article, text, fetched, dir, images } = setup({ 'https://bx1.be/inside.jpg': photo })
    article('jjjjjjjjjjjjjjjj', null)
    text('jjjjjjjjjjjjjjjj', '<p>Texte</p><img src="data:image/png;base64,AAAA"><img src="https://bx1.be/inside.jpg">')

    const file = await images.inlineFile('jjjjjjjjjjjjjjjj', 1, 960)
    assert.ok(file)
    assert.equal((await sharp(file).metadata()).width, 960)
    assert.ok(await images.inlineFile('jjjjjjjjjjjjjjjj', 1, 240))
    assert.deepEqual(fetched, ['https://bx1.be/inside.jpg'])

    // A picture without a web address, no such picture, a width the app never asks for.
    assert.equal(await images.inlineFile('jjjjjjjjjjjjjjjj', 0, 480), null)
    assert.equal(await images.inlineFile('jjjjjjjjjjjjjjjj', 5, 480), null)
    assert.equal(await images.inlineFile('jjjjjjjjjjjjjjjj', 1, 500), null)

    // Its size, from its largest copy; none for a picture not made.
    assert.deepEqual(await images.inlineSize('jjjjjjjjjjjjjjjj', 1), { width: 960, height: 540 })
    assert.equal(await images.inlineSize('jjjjjjjjjjjjjjjj', 0), null)

    // Kept while the article's text is.
    images.prune(NOW)
    assert.ok(existsSync(path.join(dir, 'jjjjjjjjjjjjjjjj.1-480.webp')))
  })

  it('never fetches a picture inside a text that is not https', async () => {
    const { article, text, fetched, images } = setup({ 'http://bx1.be/plain.jpg': photo })
    article('llllllllllllllll', null)
    text('llllllllllllllll', '<img src="http://bx1.be/plain.jpg">')

    assert.equal(await images.inlineFile('llllllllllllllll', 0, 480), null)
    assert.deepEqual(fetched, [])
  })

  it('drops the pictures of articles gone from the feeds, but not of saved ones, and stray files', async () => {
    const { db, article, dir, images } = setup({ 'https://bx1.be/photo.jpg': photo })
    article('gggggggggggggggg', 'https://bx1.be/photo.jpg', NOW - 10 * DAY)
    article('hhhhhhhhhhhhhhhh', 'https://bx1.be/photo.jpg', NOW - 10 * DAY)
    article('iiiiiiiiiiiiiiii', 'https://bx1.be/photo.jpg')
    for (const id of ['gggggggggggggggg', 'hhhhhhhhhhhhhhhh', 'iiiiiiiiiiiiiiii']) await images.file(id, 240)
    db.prepare(
      "INSERT INTO saved_articles (profile_id, article_id, item, article, saved_at) VALUES (1, 'hhhhhhhhhhhhhhhh', '{}', '{}', 0)"
    ).run()
    writeFileSync(path.join(dir, 'zzzzzzzzzzzzzzzz-240.webp'), 'left behind')

    images.prune(NOW)

    const left = readdirSync(dir)
    assert.ok(!left.some(name => name.startsWith('gggggggggggggggg') || name.startsWith('zzzz')))
    assert.ok(existsSync(path.join(dir, 'hhhhhhhhhhhhhhhh-240.webp')))
    assert.ok(existsSync(path.join(dir, 'iiiiiiiiiiiiiiii-960.webp')))
    assert.equal(images.preview('gggggggggggggggg'), null)
  })
})
