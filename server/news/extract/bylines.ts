import { type Element, firstTextNode, normalized, withWrappers } from './dom.ts'
import {
  ACCOUNT_PROMPT,
  AUTHOR_BIO,
  AUTHOR_BIO_TAIL,
  AUTHOR_IMAGE,
  AUTHOR_PAGE,
  BLOCKS,
  BYLINE_ONLY,
  DATE_LINE,
  LIVE_STATUS,
  MAX_BIO_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PROMPT_LENGTH,
  NOISE_CANDIDATES,
  SLOT_LABEL,
  TEXT_BLOCKS
} from './patterns.ts'

// The block, and an image-only block right before it: the author's photo.
const removeWithPhoto = (block: Element) => {
  const previous = block.previousElementSibling
  if (previous && normalized(previous.textContent) === '' && previous.matches('img, picture, figure, div, p, span'))
    if (previous.matches('img') || previous.querySelector('img')) previous.remove()
  if (block.nextElementSibling?.tagName === 'BR') block.nextElementSibling.remove()
  block.remove()
}

// A byline ("Par Léa Dupont"), or a block holding only a link to the author's page: a byline without its "par"
// (ActuGaming). Its name is kept, to find the author's photo. true when it went.
const removeByline = (element: Element, root: Element, text: string, names: Set<string>) => {
  if (BYLINE_ONLY.test(text) && !text.includes('. ')) {
    names.add(text.replace(/^(par|by)\s+/, ''))
    removeWithPhoto(withWrappers(element, root))
    return true
  }
  const link = element.matches(TEXT_BLOCKS) ? element.querySelector('a') : null
  if (
    link &&
    text !== '' &&
    text.length <= MAX_NAME_LENGTH &&
    normalized(link.textContent).toLowerCase() === text &&
    AUTHOR_PAGE.test(link.getAttribute('href') ?? '')
  ) {
    names.add(text)
    removeWithPhoto(withWrappers(element, root))
    return true
  }
  return false
}

// A block holding only a <time>, the page's own date line whatever its format, or a date line. true when it went.
const removeDateLine = (element: Element, root: Element, text: string) => {
  const time = element.querySelector('time')
  if (time && normalized(time.textContent) === text && text !== '') {
    removeWithPhoto(withWrappers(element, root))
    return true
  }

  const date = text.match(DATE_LINE)
  if (date && date[0].length === text.length) {
    removeWithPhoto(withWrappers(element, root))
    return true
  }
  return false
}

// A live page's status ("En cours", "Live"), a label left with nothing after it ("Animé par :"), an ad slot's
// label, an account prompt. true when it went.
const removeLabelLine = (element: Element, root: Element, text: string) => {
  const textBlock = element.matches(TEXT_BLOCKS)
  // Its wrappers are only looked for on a short label: on every block, that walk reads the text of each ancestor.
  const endsSection = () => {
    const next = withWrappers(element, root).nextElementSibling
    return !next || next.matches('h2, h3, h4, h5, h6, hr')
  }
  if (
    textBlock &&
    (LIVE_STATUS.test(text) || (text.length <= MAX_NAME_LENGTH && text.endsWith(':') && endsSection()))
  ) {
    withWrappers(element, root).remove()
    return true
  }

  if (textBlock && SLOT_LABEL.test(text)) {
    withWrappers(element, root).remove()
    return true
  }

  if (text.length <= MAX_PROMPT_LENGTH && ACCOUNT_PROMPT.test(text)) {
    withWrappers(element, root).remove()
    return true
  }
  return false
}

// An author's bio, and the name and photo above it.
const removeBio = (element: Element, root: Element, raw: string, text: string, names: Set<string>) => {
  const bio = element.matches(TEXT_BLOCKS) && text.length <= MAX_BIO_LENGTH ? AUTHOR_BIO.exec(raw) : null
  if (bio?.[1]) {
    names.add(bio[1].toLowerCase())
    removeWithPhoto(withWrappers(element, root))
  }

  if (element.matches(TEXT_BLOCKS) && text.length <= MAX_BIO_LENGTH && AUTHOR_BIO_TAIL.test(raw)) {
    const block = withWrappers(element, root)
    const name = block.previousElementSibling
    const nameText = normalized(name?.textContent)
    if (name && nameText.length > 0 && nameText.length <= MAX_NAME_LENGTH && !nameText.includes('.')) {
      names.add(nameText)
      removeWithPhoto(name)
    }
    block.remove()
  }
}

// The date line in front of the lead, in the same paragraph.
const cutLeadDate = (root: Element) => {
  for (const block of [...root.querySelectorAll(TEXT_BLOCKS)]) {
    const node = firstTextNode(block)
    const value = node?.textContent ?? ''
    const date = value.trimStart().match(DATE_LINE)
    if (node && date) node.textContent = value.trimStart().slice(date[0].length).trimStart()
  }
}

// Bylines, date lines, author bios with their photo and account prompts, wherever they sit and
// whatever the source; a date line run into the lead is cut from it.
export const removeBylines = (root: Element) => {
  const names = new Set<string>()
  for (const element of [...root.querySelectorAll(`${BLOCKS}, ${NOISE_CANDIDATES}`)]) {
    if (!element.isConnected) continue
    const raw = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    const text = raw.toLowerCase()
    // Longer than a bio, a block can only be a lone <time>: every other line looked for is shorter.
    if (text.length > MAX_BIO_LENGTH) {
      removeDateLine(element, root, text)
      continue
    }
    if (removeByline(element, root, text, names) || removeDateLine(element, root, text)) continue
    if (removeLabelLine(element, root, text)) continue
    removeBio(element, root, raw, text, names)
  }
  cutLeadDate(root)
  for (const image of [...root.querySelectorAll('img')]) {
    const alt = normalized(image.getAttribute('alt'))
    if ((alt && names.has(alt)) || AUTHOR_IMAGE.test(image.getAttribute('src') ?? '')) {
      withWrappers(image, root).remove()
    }
  }
}
