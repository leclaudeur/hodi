import { type Element, linkTextRatio, normalized, withWrappers } from './dom.ts'
import { BLOCKS, TEXT_BLOCKS } from './patterns.ts'

// A credit for the text itself, kept wherever it stands: "This article is republished from The Conversation under
// a Creative Commons license."
export const TEXT_CREDIT = /(?<!\p{L})(republished|republié|licen[cs]e|translated|traduit)(?!\p{L})/iu
const MAX_CREDIT_BLOCK_LENGTH = 300

const isTextCredit = (element: Element) => {
  const text = normalized(element.textContent)
  return text.length <= MAX_CREDIT_BLOCK_LENGTH && TEXT_CREDIT.test(text)
}

// Removes an element and everything after it, up to the root: the rest of the page is footer.
export const removeFrom = (element: Element, root: Element) => {
  let current: Element | null = element

  while (current && current !== root) {
    for (let next = current.nextElementSibling; next;) {
      const following: Element | null = next.nextElementSibling
      if (!isTextCredit(next)) next.remove()
      next = following
    }
    const parent: Element | null = current.parentElement
    if (current === element) current.remove()
    current = parent
  }
}

// Lists of short links before the first line of text, past short labels ("Menu"): the site's breadcrumb or menu
// ("1. Recettes plaisir").
// A breadcrumb's last item is the page itself, often not a link and as long as its title (Gamekult). A lone short
// link in a paragraph of its own goes too: the article's section ("news").
const MAX_CURRENT_PAGE_LENGTH = 200

export const removeLeadingNavigation = (root: Element) => {
  const isLink = (item: Element) => {
    const text = normalized(item.textContent)
    return text !== '' && text.length <= MAX_LABEL_LENGTH && linkTextRatio(item) >= 0.8
  }
  const isNavigation = (list: Element) => {
    const items = [...list.children]
    const last = items.at(-1)
    if (!last) return false
    if (items.every(isLink)) return true
    return (
      items.length >= 2 &&
      !isLink(last) &&
      normalized(last.textContent).length <= MAX_CURRENT_PAGE_LENGTH &&
      items.slice(0, -1).every(isLink)
    )
  }
  for (const element of [...root.querySelectorAll(`${TEXT_BLOCKS}, ul, ol`)]) {
    if (!element.isConnected || element.matches('li')) continue
    const text = normalized(element.textContent)
    if (element.matches('ul, ol')) {
      if (isNavigation(element)) withWrappers(element, root).remove()
      continue
    }
    if (element.matches('p') && text !== '' && text.length <= MAX_LABEL_LENGTH && linkTextRatio(element) === 1) {
      withWrappers(element, root).remove()
      continue
    }
    // The first line of text, longer than a label: what follows is the article.
    if (text.length > MAX_LABEL_LENGTH) return
  }
}

// The same picture shown again further down (a teaser of another article, a carousel's copies): one is enough.
export const removeRepeatedImages = (root: Element) => {
  const seen = new Set<string>()
  for (const image of [...root.querySelectorAll('img')]) {
    const source = image.getAttribute('src') ?? ''
    if (source === '') continue
    if (!seen.has(source)) {
      seen.add(source)
      continue
    }
    // With the link, figure or wrapper around it, as long as it holds nothing else.
    let block = image
    while (
      block.parentElement &&
      block.parentElement !== root &&
      normalized(block.parentElement.textContent) === normalized(block.textContent) &&
      block.parentElement.querySelectorAll('img').length === 1
    )
      block = block.parentElement
    block.remove()
  }
}

// A table of contents: links to the page's own headings, which the reader shows anyway. Its title goes too,
// and a title left without its list ("Sommaire", when the list is drawn by a script).
const TOC_TITLE = /^(sommaire|table of contents|article contents|contents|dans cet article|in this article)\b/i
const MAX_TOC_TITLE_LENGTH = 60

const isTableOfContents = (list: Element) => {
  const targets = [...list.querySelectorAll('a')].map(link => link.getAttribute('href') ?? '')
  if (targets.length < 2 || linkTextRatio(list) < 0.8) return false
  // Every link points into one page: "#part-1", or the article's own address followed by "#part-1".
  const pages = new Set(targets.map(href => (/#./.test(href) ? href.slice(0, href.indexOf('#')) : null)))
  return !pages.has(null) && pages.size === 1
}

export const removeTablesOfContents = (root: Element) => {
  for (const list of [...root.querySelectorAll('ul, ol')]) {
    if (!list.isConnected || !isTableOfContents(list)) continue
    const title = list.previousElementSibling
    if (title && normalized(title.textContent).length <= MAX_TOC_TITLE_LENGTH && !title.querySelector('img, ul, ol')) {
      title.remove()
    }
    withWrappers(list, root).remove()
  }
  for (const title of [...root.querySelectorAll(TEXT_BLOCKS)]) {
    const text = normalized(title.textContent)
    if (title.isConnected && text.length <= MAX_TOC_TITLE_LENGTH && TOC_TITLE.test(text)) title.remove()
  }
}

// Tags, related links and linked teaser images at the end of the text: nothing left to read there.
const MIN_UNLINKED_TEXT = 300
export const trimTrailingLinks = (container: Element) => {
  for (let last = container.lastElementChild; last; last = container.lastElementChild) {
    const text = normalized(last.textContent)
    const linkedImagesOnly = text === '' && last.querySelector('a img, a picture') !== null

    // A heading with nothing after it: its list of links went.
    const heading = /^H[1-6]$/.test(last.tagName) || last.getAttribute('role') === 'heading'
    // A wrapper holding text of its own beside its links (the whole text in one div, at times) is trimmed from the
    // inside; one holding little more than links goes whole, its heading with it.
    const wrapper =
      last.matches('div, section, article, main') &&
      last.querySelectorAll(TEXT_BLOCKS).length > 1 &&
      text.length * (1 - linkTextRatio(last)) > MIN_UNLINKED_TEXT
    if (
      (text !== '' && !wrapper && linkTextRatio(last) > 0.6) ||
      linkedImagesOnly ||
      heading ||
      last.tagName === 'HR'
    ) {
      last.remove()
      continue
    }

    if (text === '' || !last.querySelector(BLOCKS)) return

    trimTrailingLinks(last)

    // Nothing left in it but empty wrappers.
    if (normalized(last.textContent) === '' && !last.querySelector('img, picture, video, iframe')) {
      last.remove()
      continue
    }

    return
  }
}

// A box of the post's details, beside or above the text: "Date 11 novembre 2026", "Partager" and its buttons, as a
// description list (Le Grand Continent). Hodi shows the date and its own share button already. Only a short list
// whose terms are all such labels goes: a glossary stays.
const POST_DETAIL =
  /^(date|publié( le)?|mis à jour( le)?|par|auteurs?|partager|share|published|updated|by|authors?|image|photo|illustration|crédits?|credits?|rubrique|catégories?|categories?|thèmes?|topics?|tags?|temps de lecture|reading time|lecture)\s*:?$/i
const MAX_POST_DETAILS_LENGTH = 160

const removePostDetails = (root: Element) => {
  for (const list of [...root.querySelectorAll('dl')]) {
    const terms = [...list.querySelectorAll('dt')]
    if (
      terms.length > 0 &&
      terms.every(term => POST_DETAIL.test(normalized(term.textContent))) &&
      normalized(list.textContent).length <= MAX_POST_DETAILS_LENGTH
    ) {
      list.remove()
    }
  }
}

// The page's own controls, never part of the text: forms (a newsletter sign-up), "Skip to main content" links,
// and "Follow" buttons, recognised by their icon's label.
const SKIP_LINK = /^(skip to|jump to|aller au|passer au|accéder au) (the )?(main )?(content|contenu|article)/i
const FOLLOW_BUTTON = /^(follow|suivre|s’abonner|s'abonner|subscribe)$/i

export const removeSiteControls = (root: Element) => {
  for (const form of [...root.querySelectorAll('form')]) form.remove()
  removePostDetails(root)
  for (const link of [...root.querySelectorAll('a[href*="#"]')]) {
    if (SKIP_LINK.test(normalized(link.textContent))) withWrappers(link, root).remove()
  }
  for (const icon of [...root.querySelectorAll('svg[aria-label]')]) {
    if (!icon.isConnected || !FOLLOW_BUTTON.test(icon.getAttribute('aria-label') ?? '')) continue
    const button = icon.closest('li, button, a, p, div')
    if (!button || button === root) continue
    withWrappers(button, root).remove()
  }
}

// Emphasis that covers a whole paragraph or list item says nothing (a synopsis all in italics, "Liste du casting :"
// in bold italics): the text stays, the emphasis goes. A list of one short emphasised item is a section label from
// the site's template ("ARTICLE ORIGINAL"): it goes.
const EMPHASIS = 'em, i, strong, b'
const MAX_LABEL_LENGTH = 40
const MIN_PROSE_WORDS = 8
const CODE_SIGNS = /[{};<>=$]|\(\)|=>|\b(function|const|let|var|import|return|def|class)\b/

const isFullyEmphasised = (block: Element) => {
  const text = normalized(block.textContent)
  return text !== '' && [...block.querySelectorAll(EMPHASIS)].some(mark => normalized(mark.textContent) === text)
}

export const removeFullEmphasis = (root: Element) => {
  for (const list of [...root.querySelectorAll('ul, ol')]) {
    const items = [...list.children]
    const [item] = items
    if (
      items.length === 1 &&
      item &&
      !item.querySelector('a') &&
      normalized(item.textContent).length <= MAX_LABEL_LENGTH &&
      isFullyEmphasised(item)
    ) {
      list.remove()
    }
  }
  for (const block of [...root.querySelectorAll('p, li')]) {
    if (!isFullyEmphasised(block) || block.closest('h1, h2, h3, h4, h5, h6')) continue
    for (const mark of [...block.querySelectorAll(EMPHASIS)]) mark.replaceWith(...mark.childNodes)
  }
  // The same for a whole paragraph set as code when it is prose (a prompt quoted on a blog): real code stays.
  for (const code of [...root.querySelectorAll('p > code, li > code')]) {
    const text = normalized(code.textContent)
    if (
      text === normalized(code.parentElement?.textContent) &&
      text.split(' ').length >= MIN_PROSE_WORDS &&
      !CODE_SIGNS.test(text)
    ) {
      code.replaceWith(...code.childNodes)
    }
  }
}

// "Dans le reste de la série…" and its list of links to other articles; what follows it, if short, is the site's
// footer ("contact the team", "a project supported by…").
const MIN_RELATED_ITEMS = 3
const MAX_FOOTER_AFTER_RELATED = 600
const MIN_RELATED_TITLE = 35

// Everything after the list, up to the end of the article.
const textAfter = (list: Element, root: Element) => {
  let after = ''
  for (let current: Element | null = list; current && current !== root; current = current.parentElement) {
    for (let next = current.nextElementSibling; next; next = next.nextElementSibling)
      after += normalized(next.textContent)
  }
  return after
}

// A few links, each an article's title: not a list of shops or products the article is about.
const isArticleLinkList = (list: Element) => {
  const items = [...list.children]
  if (items.length < MIN_RELATED_ITEMS || !items.every(item => linkTextRatio(item) >= 0.8)) return false
  const average = items.reduce((total, item) => total + normalized(item.textContent).length, 0) / items.length
  return average >= MIN_RELATED_TITLE
}

export const removeRelatedLists = (root: Element) => {
  for (const heading of [...root.querySelectorAll('h2, h3, h4')]) {
    const list = heading.nextElementSibling
    if (!heading.isConnected || !list?.matches('ul, ol')) continue
    if (!isArticleLinkList(list)) continue

    const after = textAfter(list, root)
    const rule = heading.previousElementSibling?.matches('hr') ? heading.previousElementSibling : null
    if (after.length <= MAX_FOOTER_AFTER_RELATED) {
      removeFrom(rule ?? heading, root)
    } else {
      rule?.remove()
      list.remove()
      heading.remove()
    }
  }
}
