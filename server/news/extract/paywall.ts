import type { parseHTML } from 'linkedom'

type Document = ReturnType<typeof parseHTML>['document']

// What a site shows in place of the rest of an article kept for its subscribers (Sonovision).
const SUBSCRIBER_NOTICE =
  /cet article est réservé (aux|à nos) abonnés|la suite (de cet article )?est réservée (aux|à nos) abonnés|this (article|story) is (only )?(available )?(for|to) subscribers/i

// "isAccessibleForFree": false or "False", anywhere in the page's structured data.
const hasPaywallFlag = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasPaywallFlag)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, inner]) =>
    key === 'isAccessibleForFree' ? String(inner).toLowerCase() === 'false' : hasPaywallFlag(inner)
  )
}

const parsedJson = (text: string) => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

// A paywalled page says so in its structured data, as search engines ask (Elle). Some still serve the whole text
// (The Verge, 60 Millions): only the flag together with a teaser hides an article.
export const isSubscriberOnly = (document: Document) =>
  [...document.querySelectorAll('script[type="application/ld+json"]')].some(script =>
    hasPaywallFlag(parsedJson(script.textContent ?? ''))
  )

export const hasSubscriberNotice = (text: string) => SUBSCRIBER_NOTICE.test(text)

// A teaser stops mid-sentence on an ellipsis: "…les espaces..." (Elle). Hodi hides it rather than show a few lines,
// and never reads past the wall.
export const isTeaser = (contentHtml: string) =>
  /(\.{3}|…)\s*$/.test(
    contentHtml
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#160;|&nbsp;/g, ' ')
      .trim()
  )
