import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractArticle } from '../news/extract.ts'

const sentence = (index: number) =>
  `Un paragraphe numéro ${index} du texte, avec assez de mots pour faire une vraie phrase de l’article lu.`
const text = (index: number, preview: boolean) => ({ type: 'text', content: sentence(index), preview })
const page = (story: unknown, shown: number[]) =>
  `<!doctype html><html><head><title>Budget fédéral</title></head><body>
    <article><h1>Budget fédéral</h1>${shown.map(index => `<p>${sentence(index)}</p>`).join('')}</article>
    <script id="fusion-metadata" type="application/javascript">window.Fusion=window.Fusion||{};Fusion.arcSite="lalibre";Fusion.globalContent=${JSON.stringify(story)};Fusion.globalContentConfig={"source":"content-api"};</script>
  </body></html>`

describe('extractArticle and Arc XP stories', () => {
  it('reads the rest of a free story its page leaves to its script (La Libre)', () => {
    const story = {
      restrictions: { type: 'FREE', isRestricted: false },
      story_elements: [
        ...[1, 2, 3, 4].map(index => text(index, true)),
        { type: 'smartPlayerTarget' },
        { type: 'ad', content: 'inread' },
        { type: 'interstitial_link', content: 'Un autre article de la rédaction', url: 'https://www.lalibre.be/a' },
        { type: 'header', content: 'La suite des négociations', level: 2 },
        ...[5, 6, 7].map(index => text(index, false)),
        { type: 'list', items: [{ type: 'text', content: 'Mardi : <b>Les Engagés</b>' }] }
      ]
    }

    const article = extractArticle(page(story, [1, 2, 3, 4]), 'https://www.lalibre.be/belgique/1')

    assert.ok(article)
    assert.match(article.contentHtml, /numéro 7/)
    assert.match(article.contentHtml, /<h2>La suite des négociations<\/h2>/)
    assert.match(article.contentHtml, /<li>Mardi : <strong>Les Engagés<\/strong><\/li>/)
    assert.doesNotMatch(article.contentHtml, /inread|Un autre article/)
  })

  it('opens a free story whose page shows too little to be read', () => {
    const story = {
      restrictions: { isRestricted: false },
      story_elements: [1, 2, 3, 4, 5, 6, 7].map(index => text(index, index < 3))
    }

    assert.ok(extractArticle(page(story, [1, 2]), 'https://www.dhnet.be/sports/1'))
  })

  it("never reads a subscriber's story", () => {
    const story = {
      restrictions: { type: 'PREMIUM', isRestricted: true },
      story_elements: [1, 2, 3, 4, 5, 6, 7].map(index => text(index, index < 3))
    }

    assert.equal(extractArticle(page(story, [1, 2]), 'https://www.lalibre.be/belgique/2'), null)
  })
})
