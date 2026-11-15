import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import {
  recoverSplitText,
  removeAds,
  removeLabelledAds,
  showLiveBlogPosts,
  unmarkLayoutBlocks
} from './extract/before-readability.ts'
import { removeBylines } from './extract/bylines.ts'
import {
  type Element,
  firstTextNode,
  linkTextRatio,
  normalized,
  smallestEnclosingBlock,
  withWrappers
} from './extract/dom.ts'
import {
  flattenCaptions,
  groupPictures,
  markCompactLists,
  markEmbeds,
  removeEmptyBlocks,
  removeEmptyEmbeds,
  removeEmptyImages,
  removeTrailingRule,
  replaceFrames,
  showLazyImages,
  tidyCaptions
} from './extract/media.ts'
import {
  removeFrom,
  removeFullEmphasis,
  removeLeadingNavigation,
  removeRelatedLists,
  removeRepeatedImages,
  removeSiteControls,
  removeTablesOfContents,
  trimTrailingLinks
} from './extract/page-cleanup.ts'
import {
  BLOCKS,
  FOOTER_HEADING,
  LINK_LIST_HEADING,
  LOADING_TEXT,
  MAX_LOADING_LENGTH,
  MAX_READ_ALSO_LENGTH,
  MIN_DUPLICATE_LENGTH,
  NOISE_CANDIDATES,
  NOISE_TEXT,
  PLACEHOLDER_TEXT,
  READ_ALSO,
  SMALL_BLOCK,
  TEXT_BLOCKS
} from './extract/patterns.ts'
import { arcStoryHtml, fullerText } from './extract/arc-story.ts'
import { hasSubscriberNotice, isSubscriberOnly, isTeaser } from './extract/paywall.ts'
import { simplifyTags } from './extract/simplify.ts'

export interface ExtractedArticle {
  title: string | null
  byline: string | null
  contentHtml: string
  textLength: number
  // The page's share image (og:image), for feeds that carry no usable image.
  image: string | null
}

const shareImage = (document: ReturnType<typeof parseHTML>['document'], url: string) => {
  const content = document
    .querySelector('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]')
    ?.getAttribute('content')

  try {
    const image = content ? new URL(content.trim(), url) : null
    return image?.protocol === 'https:' ? image.toString() : null
  } catch {
    return null
  }
}

// Short lines of any element: a footer heading, a share or follow line, a loading line. true when it went.
const removeShortNoise = (element: Element, root: Element, text: string) => {
  if (text.length < 40 && FOOTER_HEADING.test(text)) {
    removeFrom(smallestEnclosingBlock(element, root), root)
    return true
  }

  if (text.length <= SMALL_BLOCK && NOISE_TEXT.test(text)) {
    smallestEnclosingBlock(element, root).remove()
    return true
  }

  if (text.length <= MAX_LOADING_LENGTH && LOADING_TEXT.test(text)) {
    withWrappers(element, root).remove()
    return true
  }
  return false
}

// The card a "Lire aussi" label heads: the other article's title, its standfirst, its authors and its picture
// (Vogue). The largest short block that starts with the label and holds a link; none when the label sits in the text.
const MAX_LINK_CARD_LENGTH = 500
const startsWith = (block: Element, label: Element) => {
  const first = firstTextNode(block)
  return first !== null && label.contains(first)
}
const linkCard = (label: Element, root: Element) => {
  let card: Element | null = null
  for (
    let block = label.parentElement;
    block && block !== root && normalized(block.textContent).length <= MAX_LINK_CARD_LENGTH && startsWith(block, label);
    block = block.parentElement
  ) {
    if (block.querySelector('a[href]')) card = block
  }
  return card
}

// A block's own: a placeholder, a « Lire aussi », a heading over a list of links to other articles.
const removeBlockNoise = (element: Element, root: Element, text: string) => {
  if (element.matches(TEXT_BLOCKS) && PLACEHOLDER_TEXT.test(text)) {
    withWrappers(element, root).remove()
    return
  }

  if (text.length <= MAX_READ_ALSO_LENGTH && READ_ALSO.test(text) && linkTextRatio(element) > 0.5) {
    withWrappers(element, root).remove()
    return
  }

  // "À la une" and its list of links to other articles.
  if (text.length < 40 && LINK_LIST_HEADING.test(text) && !element.querySelector(BLOCKS)) {
    const card = linkCard(element, root)
    if (card) {
      card.remove()
      return
    }

    const next = element.nextElementSibling
    if (next && linkTextRatio(next) > 0.6) next.remove()

    const parent = element.parentElement
    if (parent && parent !== root && linkTextRatio(parent) > 0.6) parent.remove()
    else element.remove()
  }
}

// One block of the article that is the site's, not the article's: a footer heading, a loading line, a placeholder, a
// « Lire aussi », a list of links to other articles. It goes, with what wraps it.
const removeNoise = (element: Element, root: Element) => {
  const text = normalized(element.textContent)
  if (removeShortNoise(element, root, text)) return
  if (element.matches(BLOCKS)) removeBlockNoise(element, root, text)
}

// The cleaned HTML, and its text's length for the checks that follow.
const cleanArticle = (html: string) => {
  const { document } = parseHTML(`<!doctype html><html><body><div id="hodi-root">${html}</div></body></html>`)
  const root = document.getElementById('hodi-root') as Element

  for (const image of [...root.querySelectorAll('img')]) {
    if (/logo/i.test(`${image.getAttribute('src') ?? ''} ${image.getAttribute('alt') ?? ''}`)) image.remove()
  }
  removeSiteControls(root)
  removeTablesOfContents(root)

  for (const element of [...root.querySelectorAll(`${BLOCKS}, ${NOISE_CANDIDATES}`)]) {
    if (element.isConnected) removeNoise(element, root)
  }

  removeBylines(root)
  removeLeadingNavigation(root)
  removeRepeatedImages(root)
  replaceFrames(root)
  removeEmptyImages(root)
  markEmbeds(root)
  removeEmptyEmbeds(root)
  tidyCaptions(root)
  flattenCaptions(root)
  removeFullEmphasis(root)
  removeRelatedLists(root)
  removeEmptyBlocks(root)
  removeTrailingRule(root)
  trimTrailingLinks(root)
  markCompactLists(root)
  groupPictures(root)
  simplifyTags(root)

  // A lead paragraph repeated as the first paragraph of the text: keep one, the longest.
  const blocks = [...root.querySelectorAll(TEXT_BLOCKS)].filter(block => !block.querySelector(TEXT_BLOCKS))
  const kept: { element: Element; text: string }[] = []

  for (const element of blocks) {
    const text = normalized(element.textContent)

    if (text.length < MIN_DUPLICATE_LENGTH) continue

    const earlier = kept.find(candidate => candidate.text.startsWith(text) || text.startsWith(candidate.text))

    if (!earlier) {
      kept.push({ element, text })
    } else if (text.length > earlier.text.length) {
      earlier.element.remove()
      Object.assign(earlier, { element, text })
    } else {
      element.remove()
    }
  }

  return { html: root.innerHTML, textLength: normalized(root.textContent).length }
}

export const cleanArticleHtml = (html: string) => cleanArticle(html).html

// Below this, the page is most likely a paywall teaser, a video page or a cookie wall.
export const MIN_TEXT_LENGTH = 600

// Reader-mode extraction. The HTML is sanitized again in the browser before display.
export const extractArticle = (html: string, url: string): ExtractedArticle | null => {
  const withBase = html.replace(/<head(\s[^>]*)?>/i, match => `${match}<base href="${url.replace(/"/g, '%22')}">`)
  const { document } = parseHTML(withBase)
  const image = shareImage(document, url)
  const story = arcStoryHtml(document)
  const paywalled = isSubscriberOnly(document)
  showLazyImages(document)
  removeAds(document.body as unknown as Element)
  removeLabelledAds(document.body as unknown as Element)
  unmarkLayoutBlocks(document.body as unknown as Element)
  showLiveBlogPosts(document.body as unknown as Element)
  // Readability changes the page it reads: a copy is kept to find the text's other blocks.
  const page = document.body.cloneNode(true) as unknown as Element
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], {
    charThreshold: 300
  }).parse()

  if (hasSubscriberNotice(article?.textContent ?? '')) return null
  const storyHtml = fullerText(story, article?.textContent ?? '')
  const readable = article?.content && (article.length ?? 0) >= MIN_TEXT_LENGTH ? article.content : null
  if (!storyHtml && !readable) return null

  // Counted again once cleaned: a video page's captions, credits and consent notice can pass the first count
  // and leave only a few lines (France 24).
  const { html: contentHtml, textLength } = cleanArticle(storyHtml ?? recoverSplitText(page, readable ?? ''))
  if (textLength < MIN_TEXT_LENGTH || (paywalled && isTeaser(contentHtml))) return null

  return {
    title: article?.title ?? null,
    byline: article?.byline ?? null,
    contentHtml,
    textLength,
    image
  }
}

// Article HTML carried by a feed (content:encoded), run through the same extraction.
export const extractFeedContent = (contentHtml: string, url: string) =>
  extractArticle(`<html><head></head><body><article>${contentHtml}</article></body></html>`, url)

// About 230 words a minute, some 1,380 characters: shown on the article's card.
export const CHARACTERS_PER_MINUTE = 1380
export const readingMinutes = (article: ExtractedArticle) =>
  Math.max(1, Math.round(article.textLength / CHARACTERS_PER_MINUTE))

const MAX_AUTHOR_LENGTH = 80

// The byline as a name for the card: "Par Marie Dupont" gives "Marie Dupont"; a long byline is page text, not a name.
export const articleAuthor = (article: ExtractedArticle) => {
  const author = (article.byline ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(par|by)\s+/i, '')
  return author.length > 0 && author.length <= MAX_AUTHOR_LENGTH ? author : null
}
