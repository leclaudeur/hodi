import { type SimpleIcon, siBluesky, siInstagram, siMastodon, siThreads, siTiktok, siX, siYoutube } from 'simple-icons'
import { t } from './i18n.ts'

// What the server marks in an article's HTML and the browser finishes once it is shown: the network's logo on
// an embedded post or video, and the layout of a group of pictures, which depends on their real size.

const NETWORKS: Record<string, SimpleIcon> = {
  x: siX,
  instagram: siInstagram,
  bluesky: siBluesky,
  threads: siThreads,
  tiktok: siTiktok,
  mastodon: siMastodon,
  youtube: siYoutube
}

// A brand colour too dark for the dark theme (X, Threads, TikTok are black): the text's colour instead.
const isDark = (hex: string) => {
  const channels = [0, 2, 4].map(start => parseInt(hex.slice(start, start + 2), 16))
  return Math.max(...channels) < 64
}

// The network's logo in its own colour, as people know it, or the text's colour when that one is black. Path and
// colour come from simple-icons, not from the article.
const logo = (icon: SimpleIcon) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('fill', isDark(icon.hex) ? 'currentColor' : `#${icon.hex}`)
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', icon.path)
  svg.append(path)
  return svg
}

const brandRow = (icon: SimpleIcon, label: string, href: string) => {
  const row = document.createElement('a')
  row.href = href
  row.target = '_blank'
  row.rel = 'noopener noreferrer'
  row.dataset.embedBrand = ''
  row.append(logo(icon), document.createTextNode(label))
  return row
}

const finishPosts = (root: HTMLElement) => {
  for (const post of root.querySelectorAll<HTMLElement>('blockquote[data-network]')) {
    const icon = NETWORKS[post.dataset.network ?? '']
    const href = post.dataset.href ?? ''
    if (!icon || !href.startsWith('https://') || post.querySelector('[data-embed-brand]')) continue
    const link = brandRow(icon, t('reader.embed.seeOn', { network: icon.title }), href)
    // Author at the top with the logo, date and link at the foot, when the server found them.
    const author = post.querySelector('[data-embed-author]')
    const date = post.querySelector('[data-embed-date]')
    author?.append(logo(icon))
    if (date) {
      link.replaceChildren(document.createTextNode(t('reader.embed.seeOn', { network: icon.title })))
      date.append(link)
    } else post.append(link)
  }
}

const finishVideos = (root: HTMLElement) => {
  for (const card of root.querySelectorAll<HTMLAnchorElement>('a[data-embed-card="youtube"]')) {
    if (card.querySelector('[data-embed-brand]')) continue
    const play = document.createElement('span')
    play.dataset.embedPlay = ''
    play.append(logo(siYoutube))
    const row = document.createElement('span')
    row.dataset.embedBrand = ''
    row.append(logo(siYoutube), document.createTextNode(t('reader.embed.watchOn', { network: siYoutube.title })))
    card.querySelector('img')?.after(play)
    card.append(row)
  }
}

// Pictures one after the other: a grid when every one is smaller than the column (they would look lost alone),
// one above the other when they are large. Decided once their real size is known.
const SMALL_SHARE = 0.75

const layOutGroup = (group: HTMLElement) => {
  const images = [...group.querySelectorAll('img')]
  const width = group.clientWidth
  const small = images.every(image => image.naturalWidth > 0 && image.naturalWidth <= width * SMALL_SHARE)
  group.dataset.layout = small ? 'grid' : 'stack'
}

const finishGroups = (root: HTMLElement) => {
  const cleanups: (() => void)[] = []
  for (const group of root.querySelectorAll<HTMLElement>('[data-gallery]')) {
    const images = [...group.querySelectorAll('img')]
    // Loaded now rather than when scrolled to, so the group is laid out before it is seen.
    for (const image of images) image.loading = 'eager'
    const pending = images.filter(image => !image.complete)
    if (pending.length === 0) {
      layOutGroup(group)
      continue
    }
    const settle = () => {
      if (images.every(image => image.complete)) layOutGroup(group)
    }
    for (const image of pending) {
      image.addEventListener('load', settle)
      image.addEventListener('error', settle)
      cleanups.push(() => {
        image.removeEventListener('load', settle)
        image.removeEventListener('error', settle)
      })
    }
  }
  return () => cleanups.forEach(cleanup => cleanup())
}

// Lucide's "quote" icon (the app's icon set), drawn here because the article is plain HTML, not React.
const QUOTE_PATHS = [
  'M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z',
  'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'
]

// Every quote of the article is a card under a small "Citation" heading, whatever its length.
const finishQuotes = (root: HTMLElement) => {
  for (const quote of root.querySelectorAll('blockquote:not([data-embed])')) {
    if (quote.querySelector(':scope > [data-quote-label]')) continue
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    for (const d of QUOTE_PATHS) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', d)
      svg.append(path)
    }
    const label = document.createElement('span')
    label.dataset.quoteLabel = ''
    label.append(svg, document.createTextNode(t('reader.embed.quote')))
    quote.prepend(label)
  }
}

export const finishArticle = (root: HTMLElement) => {
  finishQuotes(root)
  finishPosts(root)
  finishVideos(root)
  return finishGroups(root)
}
