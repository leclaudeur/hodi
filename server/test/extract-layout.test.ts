import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHTML } from 'linkedom'
import { extractArticle } from '../news/extract.ts'
import { unmarkLayoutBlocks } from '../news/extract/before-readability.ts'

const paragraph = (index: number) =>
  `<p>Le paragraphe ${index} de la brève : les lunettes de Google répondent à un nouveau mot d’activation, et les ` +
  `anciens restent actifs pour ceux qui les préfèrent.</p>`
const legalNotice =
  'Les données transmises par le biais de ce formulaire sont destinées à l’éditeur du site en sa qualité de ' +
  'responsable de traitement. Elles ne seront en aucun cas cédées à des tiers. Ces données sont traitées sous ' +
  'réserve d’obtention de votre consentement pour vous envoyer par e-mail des actualités. Vous pouvez vous opposer à ' +
  'tout moment à ces e-mails en cliquant sur les liens de désinscription présents dans chacun d’eux. Vous disposez ' +
  'd’un droit d’accès, de rectification, d’effacement, de limitation, de portabilité et d’opposition.'
const signUp = `<div class="newsletter-form js-newsletter-form">
  <p class="newsletter-form__title">Votre newsletter personnalisée</p>
  <p class="newsletter-form__subtitle">C'est enregistré ! Surveillez votre boîte aux lettres, vous allez entendre parler de nous !</p>
  <form action="/subscribe"><input type="email" name="email"><button>Je m'inscris</button></form>
  <div class="newsletter-form__faq"><p>${legalNotice}</p><p>${legalNotice}</p></div>
</div>`
const page = (paragraphs: number) => `<!doctype html><html><head><title>Hey Gemini</title></head>
<body><main id="page"><article class="container">
  <header><h1>Après « Hey Google », préparez-vous à dire « Hey Gemini »</h1></header>
  <div class="columns"><div class="column container-with-sidebar">
    <div class="article-content article-content--has-sidebar">${Array.from({ length: paragraphs }, (_, index) => paragraph(index + 1)).join('')}</div>
    <div class="article-footer">${signUp}</div>
  </div><div class="column article-sidebar sidebar"><p>Les plus lus</p></div></div>
</article></main></body></html>`

describe('extractArticle and the layout around a short article (Frandroid)', () => {
  it('takes away a name that says the text sits beside a sidebar, which Readability reads as a sidebar', () => {
    const { document } = parseHTML(
      '<html><body><div class="column container-with-sidebar"><div class="article-content article-content--has-sidebar">' +
        '<p>Texte</p></div></div><aside class="article-sidebar sidebar"></aside></body></html>'
    )

    unmarkLayoutBlocks(document.body as unknown as Parameters<typeof unmarkLayoutBlocks>[0])

    assert.equal(document.querySelector('.article-content')?.getAttribute('class'), 'article-content')
    assert.equal(document.querySelector('.column')?.getAttribute('class'), 'column')
    assert.equal(document.querySelector('aside')?.getAttribute('class'), 'article-sidebar sidebar')
  })

  it('leaves out a newsletter sign-up that outweighs a short article', () => {
    const article = extractArticle(page(5), 'https://www.example.com/a')

    assert.ok(article)
    assert.match(article.contentHtml, /paragraphe 5/)
    assert.doesNotMatch(article.contentHtml, /newsletter|données transmises|enregistré/)
  })
})
