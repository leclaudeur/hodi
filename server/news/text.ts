import { createHash } from 'node:crypto'
import { decodeHTML } from 'entities'

// Every HTML character reference, named or numeric, as a browser decodes it (including the legacy ones written
// without a semicolon): feeds use far more than a short list, and names are case-sensitive (&Eacute; is É).
export const decodeEntities = (text: string) => decodeHTML(text)

// Plain text from a feed's HTML snippet: tags removed, entities decoded, whitespace collapsed.
export const htmlToText = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()

// Page chrome some feeds (RTL info) paste into descriptions along with the article.
const PAGE_CHROME = /<(nav|header|footer|aside|figure|form|button)\b[\s\S]*?<\/\1>/gi
const MIN_PARAGRAPH_LENGTH = 60

// Plain-text summary of a feed description: the first real paragraph when the
// description is a whole article or page, the text itself otherwise.
export const summaryText = (html: string) => {
  const withoutChrome = html.replace(PAGE_CHROME, ' ')
  const paragraphs = [...withoutChrome.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match => htmlToText(match[1] ?? ''))

  if (paragraphs.length > 1) {
    const first = paragraphs.find(paragraph => paragraph.length >= MIN_PARAGRAPH_LENGTH)
    if (first) return first
  }

  return htmlToText(withoutChrome)
}

// First image of a feed's HTML snippet, for feeds without a media tag (WordPress).
export const firstImageInHtml = (html: string) => html.match(/<img\b[^>]*?\ssrc=["']([^"']+)["']/i)?.[1] ?? null

export const truncate = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text

  const cut = text.slice(0, maxLength - 1)
  const lastSpace = cut.lastIndexOf(' ')

  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, '')}…`
}

const TRACKING_PARAMETER = /^(utm_|at_|xtor$|fbclid$|gclid$|mc_)/i

export const canonicalLink = (link: string) => {
  const url = new URL(link)

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key)
  }

  url.hash = ''
  return url.toString()
}

export const itemId = (canonical: string) => createHash('sha256').update(canonical).digest('base64url').slice(0, 16)

// Every list asks again for the keys of the same titles: each is worked out once.
const titleKeys = new Map<string, string>()
const MAX_TITLE_KEYS = 20_000

// Lowercase, no accents or punctuation: catches the same story syndicated under two links.
export const titleKey = (title: string) => {
  let key = titleKeys.get(title)
  if (key === undefined) {
    if (titleKeys.size >= MAX_TITLE_KEYS) titleKeys.clear()
    key = title
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
    titleKeys.set(title, key)
  }
  return key
}
