import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractArticle } from '../news/extract.ts'

const paragraph = (index: number) =>
  `<p>Le paragraphe ${index} : NVIDIA confirme qu’un nouveau jeu sera disponible sur son service de cloud gaming le ` +
  `jour de sa sortie, avec les mêmes performances pour les abonnés.</p>`
const games = ['Worst Class Ever', 'Shrek 2 Remastered', 'Main Sequence', 'Graveyard Keeper', 'Tape to Tape']
  .map(name => `<li><strong>${name}</strong> (nouvelle sortie sur Steam, le 10 novembre)</li>`)
  .join('')
const related = ['Un', 'Deux', 'Trois']
  .map(name => `<li><a href="/news/${name}">${name} : l’article à lire aussi sur le même sujet cette semaine</a></li>`)
  .join('')

describe('extractArticle and the boxes in the text', () => {
  it('keeps a box that lists what the text announces, and leaves out a box of links (Gamekult)', () => {
    const page = `<!doctype html><html><head><title>GeForce Now</title></head><body><article>
      <h1>Les sorties GeForce Now de la semaine</h1>
      <div class="text">${[1, 2, 3, 4, 5].map(paragraph).join('')}<p>Et maintenant, place aux sorties de la semaine :</p>
        <aside class="square"><ul>${games}</ul></aside></div>
      <aside class="related"><ul>${related}</ul></aside>
    </article></body></html>`

    const article = extractArticle(page, 'https://www.example.com/a')

    assert.ok(article)
    assert.match(article.contentHtml, /Worst Class Ever/)
    assert.match(article.contentHtml, /Tape to Tape/)
    assert.doesNotMatch(article.contentHtml, /lire aussi/)
  })
})
