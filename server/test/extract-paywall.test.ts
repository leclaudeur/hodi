import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractArticle } from '../news/extract.ts'

const paragraph = (index: number) =>
  `<p>Un paragraphe numéro ${index} du texte, avec assez de mots pour faire une vraie phrase de l’article lu.</p>`
const paywallData = (free: boolean | string) =>
  `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    isAccessibleForFree: free,
    hasPart: { '@type': 'WebPageElement', isAccessibleForFree: free, cssSelector: '.paywall' }
  })}</script>`
const page = (head: string, body: string) =>
  `<!doctype html><html><head><title>Une maison parisienne</title>${head}</head><body><article><h1>Une maison</h1>${body}</article></body></html>`

describe('extractArticle and paywalls', () => {
  it("hides a subscriber-only page's teaser that stops on an ellipsis (Elle)", () => {
    const teaser = `${[1, 2, 3, 4, 5, 6].map(paragraph).join('')}<p>Dans cette maison du début du siècle, les espaces...</p>`

    assert.equal(extractArticle(page(paywallData(false), teaser), 'https://www.elle.fr/deco/maison'), null)
    assert.equal(extractArticle(page(paywallData('False'), teaser), 'https://www.elle.fr/deco/maison'), null)
  })

  it('keeps a page flagged as paywalled that serves its whole text (The Verge)', () => {
    const text = [1, 2, 3, 4, 5, 6, 7].map(paragraph).join('')

    assert.ok(extractArticle(page(paywallData(false), text), 'https://www.theverge.com/news/1'))
  })

  it('keeps a free page whose text ends on an ellipsis', () => {
    const text = `${[1, 2, 3, 4, 5, 6].map(paragraph).join('')}<p>Et la suite, on la connaît...</p>`

    assert.ok(extractArticle(page(paywallData(true), text), 'https://www.rtl.be/info/1'))
    assert.ok(extractArticle(page('', text), 'https://www.rtl.be/info/1'))
  })

  it('hides a page that says the article is for its subscribers (Sonovision)', () => {
    const text = `${[1, 2, 3, 4, 5, 6].map(paragraph).join('')}<div><p>Cet article est réservé aux abonnés</p>
      <p>Inscrivez-vous et accédez gratuitement à l’ensemble des news et des magazines.</p></div>`

    assert.equal(extractArticle(page('', text), 'https://www.sonovision.com/actualites/1'), null)
  })
})
