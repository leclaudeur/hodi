import assert from 'node:assert/strict'
import { test } from 'node:test'
import { removeSiteTemplate } from '../news/site-template.ts'

const follow = '<p>Suivez-nous sur WhatsApp pour ne rien rater de l’actualité.</p>'
const related =
  '<ul><li><a href="https://example.com/a">Les meilleures offres TV</a></li><li><a href="https://example.com/b">Les meilleures offres audio</a></li></ul>'
const article = (body: string, extra = '') =>
  `<h2>${body} : le contexte</h2><p>${body} est le sujet de cet article, avec assez de texte pour être un vrai paragraphe.</p>${extra}`

test('removes a repeated block about the site and a repeated list of links', () => {
  const html = article('Le budget', follow + related)
  const cleaned = removeSiteTemplate(html, [article('La météo', follow + related)])

  assert.doesNotMatch(cleaned, /Suivez-nous/)
  assert.doesNotMatch(cleaned, /meilleures offres/)
  assert.doesNotMatch(cleaned, /<ul>/)
  assert.match(cleaned, /Le budget est le sujet/)
})

test('keeps a repeated block that is neither about the site nor links', () => {
  const disclaimer = '<p>Cet article a été écrit avec l’aide de plusieurs agences de presse européennes.</p>'
  const subheading = '<h3>Ce qu’il faut retenir</h3>'
  const html = article('Le budget', subheading + disclaimer)

  assert.equal(removeSiteTemplate(html, [article('La météo', subheading + disclaimer)]), html)
})

test('keeps a block that only this article has', () => {
  const html = article('Le budget', follow)

  assert.equal(removeSiteTemplate(html, [article('La météo')]), html)
})

test('learns nothing from the same article published twice', () => {
  const html = article('Le budget', '<p>Découvrez notre dossier complet sur le budget de l’année prochaine.</p>')
  const copy = html + '<p>Un paragraphe ajouté dans la seconde version.</p>'

  assert.equal(removeSiteTemplate(html, [copy]), html)
})

test('changes nothing without other articles', () => {
  const html = article('Le budget', follow)

  assert.equal(removeSiteTemplate(html, []), html)
})

test('removes the repeated footer from its first block about the site, and keeps the repeated text before it', () => {
  const ending = '<p>The research has been published in Nature Astronomy.</p>'
  const footer =
    '<p>Vous ne voulez pas de publicité ? D’accord, mais...</p><p>Accès illimité au site</p><p>Merci, et à bientôt.</p>'
  const html = article('Le budget', ending + footer)
  const cleaned = removeSiteTemplate(html, [article('La météo', ending + footer)])

  assert.match(cleaned, /Nature Astronomy/)
  assert.doesNotMatch(cleaned, /publicité|Accès illimité|Merci/)
})

test('keeps a credit for the text in the repeated footer', () => {
  const footer =
    '<p>Abonnez-vous à notre newsletter.</p><p>This article is republished from The Conversation under a Creative Commons license.</p>'
  const html = article('Le budget', footer)
  const cleaned = removeSiteTemplate(html, [article('La météo', footer)])

  assert.doesNotMatch(cleaned, /newsletter/)
  assert.match(cleaned, /republished from The Conversation/)
})
