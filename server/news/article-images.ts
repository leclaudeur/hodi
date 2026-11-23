import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { access, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ImageStore, PictureSources } from '../db/image-store.ts'
import type { FetchBytes } from './fetch-text.ts'
import type { ImageSize } from './inline-images.ts'
import { pictureMaker, type PictureMaker } from './picture-maker.ts'
import { imageType } from './source-icons.ts'
import { CONFIG } from '../fixed-config.ts'

// Article pictures, made smaller once on the server. A news site's picture is often 1600 pixels wide and 150 KB or
// more, for a card 80 or 236 pixels wide: a phone downloading the original pays for it in time and battery. The
// server fetches it once, keeps three widths in WebP in the data folder, and a 16-pixel preview that the lists carry
// so that a blurred picture shows at once.

// The widths a card asks for through srcset: a row's square (80 px at 3x), a slider card (236 px at 2x), the large
// card of an upright tablet.
export const IMAGE_WIDTHS = [240, 480, 960] as const
export type ImageWidth = (typeof IMAGE_WIDTHS)[number]
// A picture this wide fills the largest copy: a narrower feed picture is compared with the page's share picture.
const SHARP_WIDTH = 960

const PREVIEW_WIDTH = CONFIG.images.previewWidth
const MAX_IMAGE_BYTES = CONFIG.images.maxSize
// A picture larger than this (in pixels) is refused before it is decoded. Decoded, a pixel takes up to 4 bytes: 16
// million pixels are 64 MB, which the container (256 MB with Node) can afford one at a time. A news site's picture is
// rarely past 12 million (4000 × 3000); a larger one shows from its site instead.
const MAX_INPUT_PIXELS = CONFIG.images.maxPixels
const QUALITY = CONFIG.images.quality
const PREVIEW_QUALITY = CONFIG.images.previewQuality
// New articles' pictures are made in the background, one at a time, so they are ready when a list opens: feeds are
// read every 15 minutes, and a minute later their pictures are there.
const WARM_INTERVAL_MS = CONFIG.images.warmEvery
const WARM_BATCH = CONFIG.images.warmBatch
// Pictures downloaded at once. A card someone is looking at must not wait for the others' downloads, but each one
// holds up to 8 MB until it is made smaller.
const MAX_DOWNLOADS = CONFIG.images.downloadsAtOnce
const WARM_WINDOW_MS = CONFIG.images.warmWindow

// Picture n of a text: no article has hundreds.
const MAX_INLINE_INDEX = 199

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

// An item id, as the routes check it: the only names the pictures' folder holds.
const ARTICLE_ID = /^[\w-]{16}$/

const isWidth = (width: number): width is ImageWidth => (IMAGE_WIDTHS as readonly number[]).includes(width)

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false
  )

export interface ArticleImagesOptions {
  store: ImageStore
  fetchBytes: FetchBytes
  dir: string
  now?: () => number
  log?: (message: string) => void
  // sharp, or null on a processor it cannot run on: then no picture is made and each one shows from its site.
  sharp?: PictureMaker | null
}

export class ArticleImages {
  readonly #store: ImageStore
  readonly #fetchBytes: FetchBytes
  readonly #dir: string
  readonly #now: () => number
  readonly #log: (message: string) => void
  readonly #sharp: PictureMaker | null
  readonly #previews: Map<string, string>
  // One making per article, even when several cards ask at once.
  readonly #pending = new Map<string, Promise<boolean>>()
  // Pictures inside a text that could not be made, by "id.n".
  readonly #inlineFailed = new Set<string>()
  // Pictures are downloaded a few at a time (#downloads, #waiting) and made smaller one after the other (#queue).
  #downloads = 0
  readonly #waiting: (() => void)[] = []
  #queue: Promise<unknown> = Promise.resolve()
  #warming = false

  constructor({
    store,
    fetchBytes,
    dir,
    now = Date.now,
    log = console.warn,
    sharp = pictureMaker
  }: ArticleImagesOptions) {
    this.#store = store
    this.#fetchBytes = fetchBytes
    this.#dir = dir
    this.#now = now
    this.#log = log
    this.#sharp = sharp
    this.#previews = store.previews()
    mkdirSync(dir, { recursive: true })
  }

  // The blurred preview the lists send with an article, once its picture was made.
  preview(articleId: string): string | null {
    return this.#previews.get(articleId) ?? null
  }

  #file(articleId: string, width: ImageWidth) {
    return path.join(this.#dir, `${articleId}-${width}.webp`)
  }

  // A picture inside the text: the article's id, then a dot, which an id never has.
  #inlineFile(articleId: string, index: number, width: ImageWidth) {
    return path.join(this.#dir, `${articleId}.${index}-${width}.webp`)
  }

  // The file of an article's picture at this width, made first if needed; null when there is none to show.
  async file(articleId: string, width: number): Promise<string | null> {
    if (!this.#sharp || !ARTICLE_ID.test(articleId) || !isWidth(width)) return null
    const file = this.#file(articleId, width)
    if (await exists(file)) return file
    if (this.#store.get(articleId)?.failed) return null
    return (await this.#make(articleId)) && (await exists(file)) ? file : null
  }

  // The file of picture n inside an article's text at this width, made the first time the reader asks for it.
  async inlineFile(articleId: string, index: number, width: number): Promise<string | null> {
    if (
      !this.#sharp ||
      !ARTICLE_ID.test(articleId) ||
      !isWidth(width) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > MAX_INLINE_INDEX
    )
      return null
    const file = this.#inlineFile(articleId, index, width)
    if (await exists(file)) return file
    const key = `${articleId}.${index}`
    if (this.#inlineFailed.has(key)) return null

    let made = this.#pending.get(key)
    if (!made) {
      made = this.#buildInline(articleId, index).finally(() => this.#pending.delete(key))
      this.#pending.set(key, made)
    }
    return (await made) && (await exists(file)) ? file : null
  }

  // The size of picture n inside an article's text, once the server made it: its largest copy is as wide as the
  // original up to 960 pixels, wider than the reader's column, so the reader can keep its exact place.
  async inlineSize(articleId: string, index: number): Promise<ImageSize | null> {
    if (!this.#sharp) return null
    for (const width of [...IMAGE_WIDTHS].reverse()) {
      const file = this.#inlineFile(articleId, index, width)
      if (!(await exists(file))) continue
      try {
        const { width: w, height: h } = await this.#sharp(file).metadata()
        return w && h ? { width: w, height: h } : null
      } catch {
        return null
      }
    }
    return null
  }

  async #buildInline(articleId: string, index: number): Promise<boolean> {
    const source = this.#store.inlineSourceOf(articleId, index)
    try {
      // Only https: the reader never shows a plain http picture (CSP, lib/sanitize.ts), so the server never fetches one.
      if (!source || !/^https:\/\//i.test(source)) throw new Error('no https address')
      const { bytes } = await this.#download(source)
      if (!imageType(bytes)) throw new Error('not a picture')
      await this.#encode(() => this.#resize(width => this.#inlineFile(articleId, index, width), bytes))
      return true
    } catch (error) {
      // The reader shows the site's own picture instead; the server does not try again until it restarts.
      this.#inlineFailed.add(`${articleId}.${index}`)
      if (source) this.#log(`Picture ${index} of ${articleId} not made: ${errorText(error)}`)
      return false
    }
  }

  #make(articleId: string): Promise<boolean> {
    const pending = this.#pending.get(articleId)
    if (pending) return pending

    const made = this.#build(articleId).finally(() => this.#pending.delete(articleId))
    this.#pending.set(articleId, made)
    return made
  }

  async #download(source: string) {
    if (this.#downloads >= MAX_DOWNLOADS) await new Promise<void>(resolve => this.#waiting.push(resolve))
    this.#downloads++
    try {
      return await this.#fetchBytes(source, { maxBytes: MAX_IMAGE_BYTES })
    } finally {
      this.#downloads--
      this.#waiting.shift()?.()
    }
  }

  // Runs after the pictures already waiting to be made smaller: libvips works on one at a time.
  #encode<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.catch(() => {}).then(task)
    this.#queue = run
    return run
  }

  // A picture's bytes and width. Only the picture types a feed uses; the type is read from the bytes, never from the
  // site's headers.
  async #measure(source: string) {
    const { bytes } = await this.#download(source)
    if (!imageType(bytes)) throw new Error('not a picture')
    const { width } = await this.#sharp!(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    return { bytes, width: width ?? 0 }
  }

  // The sharper of the feed's picture and the page's: a feed often carries a small one (7sur7: 400 px), where the
  // page's share picture is 1200 px or more. The page's is only downloaded when the feed's is too narrow or fails.
  async #sharpest({ feed, page }: PictureSources) {
    const first = (feed ?? page)!
    const second = feed && page && page !== feed ? page : null
    const picked = await this.#measure(first).catch((error: unknown) => {
      if (!second) throw error
      return null
    })
    if (!second || (picked && picked.width >= SHARP_WIDTH)) return { ...picked!, pageChecked: null }
    const other = await this.#measure(second).catch((error: unknown) => {
      if (!picked) throw error
      return null
    })
    const best = other && (!picked || other.width > picked.width) ? other : picked!
    return { ...best, pageChecked: second }
  }

  async #build(articleId: string): Promise<boolean> {
    const sources = this.#store.sources(articleId)
    if (!sources.feed && !sources.page) return false

    try {
      const { bytes, width, pageChecked } = await this.#sharpest(sources)
      const url = await this.#encode(async () => {
        await this.#resize(size => this.#file(articleId, size), bytes)
        return this.#preview(bytes)
      })

      this.#store.save(articleId, { preview: url, failed: false, createdAt: this.#now(), width, pageChecked })
      this.#previews.set(articleId, url)
      return true
    } catch (error) {
      // The card shows the original instead (the site may still answer the phone), and the server tries again later.
      this.#store.save(articleId, { preview: null, failed: true, createdAt: this.#now() })
      this.#log(`Picture of ${articleId} not made: ${errorText(error)}`)
      return false
    }
  }

  // Writes the three widths.
  async #resize(fileOf: (width: ImageWidth) => string, bytes: Buffer) {
    const picture = this.#sharp!(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()
    for (const width of IMAGE_WIDTHS) {
      const file = fileOf(width)
      const data = await picture
        .clone()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer()
      // Written aside then renamed: a card never gets half a file.
      await writeFile(`${file}.tmp`, data)
      await rename(`${file}.tmp`, file)
    }
  }

  // The 16-pixel preview the lists carry, as a data URL.
  async #preview(bytes: Buffer) {
    const preview = await this.#sharp!(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: PREVIEW_WIDTH })
      .webp({ quality: PREVIEW_QUALITY })
      .toBuffer()
    return `data:image/webp;base64,${preview.toString('base64')}`
  }

  // Makes the pictures of the newest articles that have none yet. One at a time, so that a card someone opens gets a download at once; until none is left, a batch after another.
  async warm() {
    if (this.#warming || !this.#sharp) return
    this.#warming = true
    try {
      // An article tried once in this pass is not tried again, even if it still has no picture.
      const tried = new Set<string>()
      for (;;) {
        const batch = this.#store
          .missing(this.#now() - WARM_WINDOW_MS, WARM_BATCH + tried.size, SHARP_WIDTH)
          .filter(articleId => !tried.has(articleId))
          .slice(0, WARM_BATCH)
        if (batch.length === 0) return
        for (const articleId of batch) {
          tried.add(articleId)
          await this.#make(articleId)
        }
      }
    } finally {
      this.#warming = false
    }
  }

  start() {
    const timer = setInterval(() => void this.warm(), WARM_INTERVAL_MS)
    timer.unref()
    return () => clearInterval(timer)
  }

  // With the database's maintenance: old pictures go, and any file no article keeps.
  prune(now: number) {
    for (const articleId of this.#store.prune(now)) this.#previews.delete(articleId)
    const kept = this.#store.kept()
    const withText = this.#store.withText()
    for (const name of readdirSync(this.#dir)) {
      // An id is 16 characters; a picture inside a text has a dot after it.
      const articleId = name.slice(0, 16)
      const inline = name[16] === '.'
      const keep = inline ? withText.has(articleId) : kept.has(articleId)
      const making = [...this.#pending.keys()].some(key => key.startsWith(articleId))
      if (!keep && !making) rmSync(path.join(this.#dir, name), { force: true })
    }
  }
}
