import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractArticle } from '../news/extract.ts'

const book = (index: number) =>
  `<li class="gallery-preview__item"><details><summary><h3>Le livre numéro ${index}</h3></summary>` +
  `<p class="gallery-preview__item-description">Le roman ${index} explore les secrets d’une famille, ses silences ` +
  `et ses blessures intimes, porté par une voix qui ne devrait laisser personne indifférent.</p></details></li>`

describe('extractArticle and galleries', () => {
  it("reads a gallery's slides, named for the site's script, without its button (Elle)", () => {
    const page = `<!doctype html><html><head><title>Prix littéraires</title></head><body><main><article class="article">
      <h1>Les livres d’autrices que la rédaction aurait récompensés</h1>
      <div class="article-header"><figure><img src="https://www.example.com/a.jpg"><p>5 Voir la galerie</p></figure></div>
      <p>Cette année, les grands prix littéraires ont surtout couronné des hommes, laissant de
      nombreuses autrices sans récompense : voici les cinq livres de femmes que nous aurions aimé voir primés.</p>
      <p>Goncourt, Renaudot, Femina : chaque année, ces distinctions font et défont les réputations littéraires, et
      les autrices ne sont pas toujours celles qui montent sur scène, alors nous mettons en lumière d’autres voix.</p>
      <div class="gallery-preview js-widget-toggle js-gallery-modal-toggle"><h2>À découvrir dans cette galerie :</h2>
        <ul>${[1, 2, 3, 4, 5].map(book).join('')}</ul></div>
    </article></main></body></html>`

    const article = extractArticle(page, 'https://www.example.com/a')

    assert.ok(article)
    assert.match(article.contentHtml, /Le roman 5 explore/)
    assert.doesNotMatch(article.contentHtml, /Voir la galerie/)
  })
})
