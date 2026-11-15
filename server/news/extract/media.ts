import type { parseHTML } from 'linkedom'
import { type Element, normalized, normalizedText, withWrappers } from './dom.ts'
import { removeFrom } from './page-cleanup.ts'
import {
  BLOCKS,
  CREDIT_ONLY,
  MAX_COMPACT_ITEM_LENGTH,
  MAX_CREDIT_LENGTH,
  MAX_ICON_SIZE,
  MAX_TRAILING_TEXT,
  MIN_COMPACT_ITEMS,
  TEXT_BLOCKS
} from './patterns.ts'

const MEDIA = 'img, picture, video, iframe, hr'

// Lazy images keep their address in data-src until a script swaps it in: the script never runs here.
const LAZY_SOURCES = ['data-src', 'data-lazy-src', 'data-original', 'data-orig-file']
const LAZY_SETS = ['data-srcset', 'data-lazy-srcset']
export const showLazyImages = (document: ReturnType<typeof parseHTML>['document']) => {
  for (const element of [...document.querySelectorAll('img, source')]) {
    const src = element.getAttribute('src') ?? ''
    const lazy = LAZY_SOURCES.map(name => element.getAttribute(name)).find(Boolean)
    if (lazy && (src === '' || src.startsWith('data:'))) element.setAttribute('src', lazy)
    const set = LAZY_SETS.map(name => element.getAttribute(name)).find(Boolean)
    if (set && !element.getAttribute('srcset')) element.setAttribute('srcset', set)
  }
}

// Images that show nothing (still a placeholder) or only an icon: a network's, an app's.
export const removeEmptyImages = (root: Element) => {
  for (const image of [...root.querySelectorAll('img')]) {
    const src = image.getAttribute('src') ?? ''
    const width = Number(image.getAttribute('width'))
    const height = Number(image.getAttribute('height'))
    const icon = width > 0 && height > 0 && width <= MAX_ICON_SIZE && height <= MAX_ICON_SIZE
    if (!src || src.startsWith('data:') || icon) (image.closest('picture') ?? image).remove()
  }
}

// Captions: one that is only a credit goes; the credit after "//" ("Le président // Source : …")
// is set apart, in small type.
export const tidyCaptions = (root: Element) => {
  for (const caption of [...root.querySelectorAll('figcaption')]) {
    const text = normalized(caption.textContent)
    const figure = caption.closest('figure')
    // Its picture gone: nothing left to caption.
    if (figure && !figure.querySelector(MEDIA)) {
      figure.remove()
      continue
    }
    if (text === '' || (text.length <= MAX_CREDIT_LENGTH && CREDIT_ONLY.test(text))) {
      caption.remove()
      continue
    }
    const node = [...caption.childNodes].find(child => child.nodeType === 3 && (child.textContent ?? '').includes('//'))
    if (!node) continue
    const [before = '', ...after] = (node.textContent ?? '').split('//')
    const credit = caption.ownerDocument.createElement('small')
    credit.append(`${after.join('//').trim()}${node.nextSibling ? ' ' : ''}`)
    while (node.nextSibling) credit.append(node.nextSibling)
    node.textContent = before.trimEnd()
    caption.append(credit)
  }
}

// An embedded post (a tweet) stays as its text, marked for the reader to show it as a card rather than
// as the article's own pull quote; its picture link, "pic.twitter.com/…", goes.
const EMBED_LINK =
  /^https:\/\/(www\.)?(x|twitter|bsky|mastodon|threads|instagram|tiktok)\.[a-z.]+\/.*\/(status|post|p|reel|video)\//i
const networkOf = (href: string) => {
  const host = new URL(href).hostname.replace(/^www\./, '')
  if (/^(x|twitter)\.com$/.test(host)) return 'x'
  if (/instagram\.com$/.test(host)) return 'instagram'
  if (/bsky\.app$/.test(host)) return 'bluesky'
  if (/threads\.(net|com)$/.test(host)) return 'threads'
  if (/tiktok\.com$/.test(host)) return 'tiktok'
  return 'mastodon'
}

// "— Jane Doe (@jane) October 30, 2026" under an embedded post: the author goes to the top of the card,
// the date to its foot, as the network shows them.
const ATTRIBUTION = /^[—–-]\s*(.+?)\s*\((@[\w.@-]+)\)\s*$/u

const moveAttribution = (quote: Element) => {
  const date = [...quote.querySelectorAll('a')].pop()
  const before = date?.previousSibling
  const match = before?.nodeType === 3 ? ATTRIBUTION.exec((before.textContent ?? '').trim()) : null
  if (!date || !before || !match) return
  const [, name = '', handle = ''] = match
  const document = quote.ownerDocument
  const holder = date.parentElement

  const author = document.createElement('p')
  author.setAttribute('data-embed-author', '')
  const strong = document.createElement('strong')
  strong.textContent = name
  const span = document.createElement('span')
  span.textContent = handle
  author.append(strong, span)

  const foot = document.createElement('p')
  foot.setAttribute('data-embed-date', '')
  foot.textContent = normalizedText(date.textContent)

  before.remove()
  date.remove()
  if (holder && holder !== quote && normalized(holder.textContent) === '') holder.remove()
  quote.prepend(author)
  quote.append(foot)
}

export const markEmbeds = (root: Element) => {
  for (const link of [...root.querySelectorAll('a')]) {
    if (/^pic\.(twitter|x)\.com\//i.test(normalized(link.textContent))) link.remove()
  }
  for (const quote of [...root.querySelectorAll('blockquote')]) {
    const links = [...quote.querySelectorAll('a')].map(link => link.getAttribute('href') ?? '')
    const post = links.find(href => EMBED_LINK.test(href))
    if (!post) continue
    quote.setAttribute('data-embed', '')
    // The network, for the card's logo and its "Voir sur …" link.
    quote.setAttribute('data-network', networkOf(post))
    quote.setAttribute('data-href', post)
    moveAttribution(quote)
  }
}

// Embedded players and frames never run in the reader. A YouTube video becomes a card: its thumbnail (YouTube's
// public image address) and a link to watch it there. Anything else (a podcast player, an ad) goes, with the
// figure or wrapper that held only it and its caption.
const FRAMES = 'iframe, embed, object, video, audio'
const YOUTUBE_EMBED = /^(?:https?:)?\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/i
const GENERIC_FRAME_TITLE = /^(youtube( video)? player|lecteur vidéo youtube|vidéo youtube|embedded content)$/i

const youtubeCard = (frame: Element, videoId: string) => {
  const document = frame.ownerDocument
  const card = document.createElement('a')
  card.setAttribute('href', `https://www.youtube.com/watch?v=${videoId}`)
  card.setAttribute('data-embed-card', 'youtube')
  const image = document.createElement('img')
  image.setAttribute('src', `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)
  image.setAttribute('alt', '')
  card.append(image)
  const title = normalizedText(frame.getAttribute('title'))
  if (title && !GENERIC_FRAME_TITLE.test(title)) {
    const label = document.createElement('span')
    label.textContent = title
    card.append(label)
  }
  return card
}

export const replaceFrames = (root: Element) => {
  for (const frame of [...root.querySelectorAll(FRAMES)]) {
    if (!frame.isConnected) continue
    const videoId = YOUTUBE_EMBED.exec(frame.getAttribute('src') ?? frame.getAttribute('data-src') ?? '')?.[1]
    const figure = frame.closest('figure')
    const holder = figure && !figure.querySelector('img') ? figure : withWrappers(frame, root)
    if (videoId) holder.replaceWith(youtubeCard(frame, videoId))
    else holder.remove()
  }
}

// An embedded post whose text did not come through (only its link or date) shows nothing worth a card.
const MIN_EMBED_TEXT = 20
export const removeEmptyEmbeds = (root: Element) => {
  for (const quote of [...root.querySelectorAll('blockquote[data-embed]')]) {
    const text = normalized(
      [...quote.childNodes]
        .filter(node => node.nodeType !== 1 || (node as unknown as Element).tagName !== 'A')
        .map(node => node.textContent)
        .join(' ')
    )
    if (text.replace(/[—–-]\s*\S+\s*\(@\w+\).*$/, '').length < MIN_EMBED_TEXT) quote.remove()
  }
}

// One caption style whatever the site: its text on one line, without its own formatting, icons or paragraphs,
// and its credit ("© AFP", "Photo : Belga") set apart. A caption that repeats the one before goes (RTL info).
const CREDIT_TAIL =
  /\s*(?:[|/—–-]\s*)?((?:©|\(c\)|crédits?\s*:|credits?\s*:|photo(?:graph)?\s*:|illustration\s*:|source\s*:|image\s*:)\s*[^©]{1,80})$/i
export const flattenCaptions = (root: Element) => {
  let previous = ''
  for (const caption of [...root.querySelectorAll('figcaption')]) {
    // A credit the site set apart already (tidyCaptions) keeps its link.
    const credit = caption.querySelector('small')
    credit?.remove()
    for (const icon of [...caption.querySelectorAll('svg, img, picture, button')]) icon.remove()
    let text = normalizedText(caption.textContent)
    let tail: string | null = null
    const match = credit ? null : text.match(CREDIT_TAIL)
    if (match?.[1] && match.index && match.index > 0) {
      tail = match[1].trim()
      text = text.slice(0, match.index).trim()
    }
    if (text.toLowerCase() === previous && !credit && !tail) {
      caption.remove()
      continue
    }
    previous = text.toLowerCase()
    caption.textContent = text
    if (credit) caption.append(credit)
    else if (tail) {
      const small = caption.ownerDocument.createElement('small')
      small.textContent = tail
      caption.append(small)
    }
  }
}

// Pictures one after the other, with no text between them, become one group: the reader lays out small ones in
// a grid and stacks large ones.
const isPictureBlock = (element: Element) =>
  element.querySelector('img') !== null &&
  normalized(
    [...element.childNodes]
      .filter(node => (node as unknown as Element).tagName !== 'FIGCAPTION')
      .map(node => node.textContent)
      .join(' ')
  ) === '' &&
  !element.querySelector(TEXT_BLOCKS)

export const groupPictures = (root: Element) => {
  for (const parent of [root, ...root.querySelectorAll('div, section, article')]) {
    const children = [...parent.children]
    let run: Element[] = []
    const flush = () => {
      if (run.length >= 2) {
        const group = parent.ownerDocument.createElement('div')
        group.setAttribute('data-gallery', '')
        run[0]?.before(group)
        for (const item of run) group.append(item)
      }
      run = []
    }
    for (const child of children) {
      if (child.matches('[data-gallery]')) {
        flush()
        continue
      }
      if (child.matches('figure, picture, img, p, div') && isPictureBlock(child)) run.push(child)
      else flush()
    }
    flush()
  }
}

// After the last rule, a few words only: share buttons, a newsletter prompt.
export const removeTrailingRule = (root: Element) => {
  const rules = [...root.querySelectorAll('hr')]
  const last = rules.at(-1)
  if (!last) return
  let after = ''
  for (let node: Element | null = last; node && node !== root; node = node.parentElement) {
    for (let next = node.nextElementSibling; next; next = next.nextElementSibling) after += ` ${next.textContent ?? ''}`
  }
  if (normalized(after).length < MAX_TRAILING_TEXT) removeFrom(last, root)
}

// A long list of short items (the games of a bundle) is shown in columns by the reader.
export const markCompactLists = (root: Element) => {
  for (const list of [...root.querySelectorAll('ul, ol')]) {
    const items = [...list.children].filter(child => child.tagName === 'LI')
    if (
      items.length >= MIN_COMPACT_ITEMS &&
      items.every(item => normalized(item.textContent).length <= MAX_COMPACT_ITEM_LENGTH && !item.querySelector(BLOCKS))
    )
      list.setAttribute('data-compact', '')
  }
}

// Wrappers left with nothing in them once their content went.
export const removeEmptyBlocks = (root: Element) => {
  for (const element of [...root.querySelectorAll(BLOCKS)].reverse()) {
    if (normalized(element.textContent) === '' && !element.querySelector(MEDIA)) element.remove()
  }
}
