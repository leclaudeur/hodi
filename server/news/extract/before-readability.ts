import { parseHTML } from 'linkedom'
import { type Element, normalized } from './dom.ts'

// Ad slots and promoted blocks, by their class or id: removed before Readability scores the page, so an ad
// between two parts of the text cannot split it.
const AD_TOKEN =
  /^(ads?|advert\w*|ad[-_]\w+|\w+[-_]ads?|adsbygoogle|sponsor\w*|outbrain\w*|taboola\w*|publicite|pub[-_]\w+|dfp\w*|teads\w*)$/i
const NOT_CONTENT = 'script, style, noscript, iframe, form, button, nav, svg, template, dialog'

export const removeAds = (root: Element) => {
  for (const element of [...root.querySelectorAll('[class], [id]')]) {
    if (!element.isConnected || element.matches('html, body, article, main')) continue
    const tokens = `${element.getAttribute('class') ?? ''} ${element.getAttribute('id') ?? ''}`.split(/\s+/)
    if (!tokens.some(token => AD_TOKEN.test(token))) continue
    // A page wrapper that also carries an ad skin's class (VGC) holds the article: an ad holds no paragraphs.
    const paragraphs = [...element.querySelectorAll('p')].filter(p => normalized(p.textContent).length > 100)
    if (paragraphs.length < 3) element.remove()
  }
}

// A card that labels itself as an ad ("Sponsorisé", with a brand's offer): the label's card goes with it,
// as long as it holds none of the article's paragraphs.
const AD_LABEL = /^(sponsorisé|sponsored|publicité|advertisement|annonce|contenu sponsorisé|sponsored content)$/i
const MAX_AD_CARD_LENGTH = 500
const MAX_AD_PARAGRAPH_LENGTH = 150

// The largest block around an ad's label that is still only the ad: no title, no long text, no real paragraph.
const adCardOf = (label: Element) => {
  let card = label
  for (let parent = card.parentElement; parent; parent = parent.parentElement) {
    if (parent.matches('body, article, main') || parent.querySelector('h1')) break
    if (normalized(parent.textContent).length > MAX_AD_CARD_LENGTH) break
    if ([...parent.querySelectorAll('p')].some(p => normalized(p.textContent).length > MAX_AD_PARAGRAPH_LENGTH)) break
    card = parent
  }
  return card
}

export const removeLabelledAds = (root: Element) => {
  for (const label of [...root.querySelectorAll('div, span, p, small, strong')]) {
    if (!label.isConnected || label.children.length > 0 || !AD_LABEL.test(normalized(label.textContent))) continue
    const card = adCardOf(label)
    if (card !== label) card.remove()
  }
}

// Readability judges a block by its class and id: it drops "sidebar" blocks before scoring the page, and scores
// down "share" and "comment" ones. ActuGaming names its two-column layout "sidebar", text column included, and wraps
// the text in its share block: the article was lost, and a sponsored card or the related links came instead.
// The word on its own ("ag-sidebar"), not inside a longer name: the BBC's "ContainerWithSidebarWrapper" also holds
// its tag list, which Readability rightly leaves out.
const SIDEBAR = /(^|[\s_-])sidebar([\s_-]|$)/i
const MIN_REAL_PARAGRAPH = 300

export const unmarkLayoutBlocks = (root: Element) => {
  // A "sidebar" holding the article's title (its h1) is the page's layout: it loses that word.
  const title = root.querySelector('h1')
  for (
    let element: Element | null = title?.parentElement ?? null;
    element && element !== root;
    element = element.parentElement
  ) {
    const tokens: string[] = (element.getAttribute('class') ?? '').split(/\s+/)
    if (tokens.some(token => SIDEBAR.test(token))) {
      element.setAttribute('class', tokens.filter(token => token !== '' && !SIDEBAR.test(token)).join(' '))
    }
    if (SIDEBAR.test(element.getAttribute('id') ?? '')) element.removeAttribute('id')
  }
  // A heading's id is an anchor made from its words ("h-comment-installer-le-mod"): Readability reads it as a
  // layout word and drops the heading.
  for (const heading of [...root.querySelectorAll('h2[id], h3[id], h4[id], h5[id], h6[id]')]) {
    heading.removeAttribute('id')
  }
  // A share block holding a real paragraph is taken away and its content left in its place, so the text also sits
  // next to its standfirst again (Readability adds a block's siblings, not its parent's).
  for (const element of [...root.querySelectorAll('[class*="share" i], [id*="share" i]')]) {
    if (!element.isConnected || element.matches('html, body, article, main')) continue
    if ([...element.querySelectorAll('p')].some(p => normalized(p.textContent).length >= MIN_REAL_PARAGRAPH)) {
      element.replaceWith(...element.childNodes)
    }
  }
}

// A live page whose posts are drawn by a script (France 24's live blogs) also sends them in the page, in a hidden
// copy: Readability skips hidden blocks, and only the page's header was left. The copy is shown again, only inside a
// block that says it is a live blog, so that a hidden article (a paywall's) stays hidden.
const LIVE_BLOG = '[data-liveblog], [class*="liveblog" i], [class*="live-blog" i]'

export const showLiveBlogPosts = (root: Element) => {
  for (const live of [...root.querySelectorAll(LIVE_BLOG)]) {
    for (const hidden of [...live.querySelectorAll('[style*="display" i]')]) {
      if (/display\s*:\s*none/i.test(hidden.getAttribute('style') ?? '') && hidden.querySelector('p')) {
        hidden.removeAttribute('style')
      }
    }
  }
}

// Some sites (Ars Technica, the BBC) cut the text into several blocks of the same kind, with ads or
// pictures between them; Readability keeps the block it scored best and loses the rest. The other blocks
// shaped like the one the text starts in are added back, in page order.
const MIN_PART_LENGTH = 150

const signatureOf = (element: Element) =>
  [element.tagName, element.getAttribute('class') ?? '', element.getAttribute('data-component') ?? ''].join('|')

export const recoverSplitText = (page: Element, extracted: string) => {
  const { document } = parseHTML(`<!doctype html><html><body>${extracted}</body></html>`)
  const paragraphs = [...document.body.querySelectorAll('p')].map(p => normalized(p.textContent)).filter(Boolean)
  const first = paragraphs[0]
  if (!first) return extracted
  const start = [...page.querySelectorAll('p')].find(p => normalized(p.textContent) === first)
  let block = start?.parentElement ?? null
  while (block && !block.getAttribute('class') && !block.getAttribute('data-component')) block = block.parentElement
  if (!block || block.matches('body, html, article, main')) return extracted
  const signature = signatureOf(block)
  const known = new Set(paragraphs)
  const parts = [...page.querySelectorAll(block.tagName)].filter(
    candidate =>
      signatureOf(candidate) === signature &&
      !candidate.contains(block) &&
      !block.contains(candidate) &&
      normalized(candidate.textContent).length >= MIN_PART_LENGTH
  )
  // Blocks after the article's title (its h1), or after the first block when the page has none: what comes
  // before is the site's header. Page order is read from the element list (linkedom's compareDocumentPosition
  // is not reliable).
  const order = [...page.querySelectorAll('*')]
  const title = page.querySelector('h1')
  const from = title ? order.indexOf(title) : order.indexOf(block)
  const after = parts.filter(candidate => order.indexOf(candidate) > from)
  const added = after.filter(candidate =>
    [...candidate.querySelectorAll('p')].some(p => !known.has(normalized(p.textContent)) && normalized(p.textContent))
  )
  if (added.length === 0) return extracted
  for (const part of added) for (const junk of [...part.querySelectorAll(NOT_CONTENT)]) junk.remove()
  const position = order.indexOf(block)
  const html = (list: Element[]) => list.map(part => part.innerHTML).join('')
  return `${html(added.filter(part => order.indexOf(part) < position))}${extracted}${html(
    added.filter(part => order.indexOf(part) > position)
  )}`
}
