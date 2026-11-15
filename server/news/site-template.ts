import { parseHTML } from 'linkedom'
import { TEXT_CREDIT } from './extract/page-cleanup.ts'

type Element = ReturnType<ReturnType<typeof parseHTML>['document']['createElement']>

// A site's own furniture inside its articles: the same "follow us", newsletter or "other deals" block in every
// article. Readability cannot tell it from the text, but other articles of the same source can: a block found
// word for word in another article is the site's, as long as it speaks about the site or is a set of links.
// A repeated block that is neither (a topical subheading, a recurring disclaimer) stays.

const TEXT_BLOCKS = 'p, li, h2, h3, h4, h5, h6, blockquote'
const BLOCKS = 'p, div, section, aside, header, footer, figure, ul, ol, li, h2, h3, h4, h5, h6, blockquote'
const MEDIA = 'img, picture, video, iframe, hr'

// The site talking about itself or to its reader: its accounts, newsletter, app, offers and ads.
const ABOUT_THE_SITE = new RegExp(
  [
    String.raw`\b(nos|notre|our)\b`,
    String.raw`\b(suivez|suis|rejoignez|rejoins|abonnez|abonne|inscrivez|inscris|téléchargez|télécharge|soutenez|soutiens)[-\s]`,
    String.raw`\b(follow|subscribe|sign up|download|support) (us|our|to|below)\b`,
    String.raw`\bnewsletter\b`,
    String.raw`\b(follow topics|email updates|personali[sz]ed (homepage|feed))\b`,
    String.raw`^(publicité|advertisement|sponsorisé|sponsored)(?!\p{L})`,
    // Its walls: ads, cookies, subscriptions. A word ending in "é" has no \b after it: a letter must not follow.
    String.raw`(?<!\p{L})(publicités?|cookies|abonnés|ad ?blocker)(?!\p{L})`
  ].join('|'),
  'iu'
)

const MIN_LINK_SHARE = 0.6
// Two articles sharing most of the shorter one's blocks are the same article published twice: nothing to learn
// from them.
const MAX_SHARED_SHARE = 0.8

const textOf = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim()
const keyOf = (text: string) => text.toLowerCase()

const linkShare = (element: Element, text: string) => {
  const linked = [...element.querySelectorAll('a')].reduce((length, link) => length + textOf(link).length, 0)
  return text.length === 0 ? 0 : linked / text.length
}

const bodyOf = (html: string) => parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body

const blockKeys = (root: Element) =>
  new Set(
    [...root.querySelectorAll(TEXT_BLOCKS)]
      .map(textOf)
      .filter(text => text.length > 0)
      .map(keyOf)
  )

// The blocks the article shares with the source's other articles: the site's own. An article that shares most of
// its blocks with another is the same text, not a template.
const sharedKeys = (own: Set<string>, others: string[]) => {
  const seen = new Set<string>()
  for (const other of others) {
    const keys = blockKeys(bodyOf(other))
    const shared = [...own].filter(key => keys.has(key))
    if (shared.length / Math.min(own.size, keys.size) > MAX_SHARED_SHARE) continue
    for (const key of shared) seen.add(key)
  }
  return seen
}

const footerOf = (blocks: Element[], seen: Set<string>, isSites: (block: Element) => boolean) => {
  // In the repeated blocks the text ends with, everything from the first one that is plainly the site's is its
  // footer: its labels ("Merci, et à bientôt.", "Information !") and its teasers. The repeated blocks before it
  // ("The research was published in Nature.") are the text's.
  let start = blocks.length
  while (start > 0 && seen.has(keyOf(textOf(blocks[start - 1]!)))) start--
  const first = blocks.slice(start).findIndex(isSites)
  // A credit for the text itself stays, whatever follows it: a licence, a republication, a translation.
  return new Set(first === -1 ? [] : blocks.slice(start + first).filter(block => !TEXT_CREDIT.test(textOf(block))))
}

export const removeSiteTemplate = (html: string, others: string[]) => {
  if (others.length === 0) return html

  const root = bodyOf(html)
  const own = blockKeys(root)
  if (own.size === 0) return html

  const seen = sharedKeys(own, others)
  if (seen.size === 0) return html

  const blocks = [...root.querySelectorAll(TEXT_BLOCKS)].filter(block => textOf(block) !== '')
  const isSites = (block: Element) => {
    const text = textOf(block)
    return ABOUT_THE_SITE.test(text) || linkShare(block, text) >= MIN_LINK_SHARE
  }

  const sites = footerOf(blocks, seen, isSites)

  let removed = false
  for (const block of blocks) {
    // Already gone with a list or a quote around it.
    if (!block.isConnected || !seen.has(keyOf(textOf(block)))) continue
    if (sites.has(block) || isSites(block)) {
      block.remove()
      removed = true
    }
  }
  if (!removed) return html

  // Lists and wrappers left empty.
  for (const element of [...root.querySelectorAll(BLOCKS)].reverse()) {
    if (textOf(element) === '' && !element.querySelector(MEDIA)) element.remove()
  }
  return root.innerHTML
}
