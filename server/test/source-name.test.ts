import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nameFromSite, siteNameOf, tidySourceName } from '../news/source-name.ts'

describe('source names', () => {
  it('keeps the site name a feed title holds, with a short section after it', () => {
    assert.equal(
      tidySourceName('Beauté - Marie Claire Belgique', 'https://www.marieclaire.be/fr/feed'),
      'Marie Claire · Beauté'
    )
    assert.equal(
      tidySourceName('Journal des Femmes : Derniers contenus', 'https://www.journaldesfemmes.fr/rss'),
      'Journal des Femmes'
    )
    assert.equal(tidySourceName('Flux d’actualité Elle.fr', 'https://www.elle.fr/rss'), 'Elle.fr')
    assert.equal(tidySourceName('France 24 - Infos, news & actualités', 'https://www.france24.com/fr/rss'), 'France 24')
    assert.equal(
      tidySourceName('Ars Technica - All content', 'https://feeds.arstechnica.com/arstechnica/index'),
      'Ars Technica'
    )
  })

  it('leaves a plain name as it is', () => {
    for (const name of ['Le Soir', 'RTL info', 'The Verge', 'Les Numériques', 'Le Monde.fr']) {
      assert.equal(tidySourceName(name, 'https://www.example.com/rss'), name)
    }
  })

  it('falls back on the site’s own name, else its address, when the title is a label or a sentence', () => {
    assert.equal(
      tidySourceName("https://www.voici.fr : flux d'articles", 'https://www.voici.fr/rss.xml', 'Voici'),
      'Voici'
    )
    assert.equal(tidySourceName("https://www.voici.fr : flux d'articles", 'https://www.voici.fr/rss.xml'), 'voici.fr')
    const sentence = "Actualité : tout ce que vous devez savoir sur l'actualité people et mode"
    assert.equal(tidySourceName(sentence, 'https://www.elle.be/fr/feed', 'ELLE Belgique'), 'ELLE')
    assert.equal(tidySourceName('Tech', 'https://www.numerama.com/tech/feed/', 'Numerama'), 'Numerama · Tech')
    assert.equal(tidySourceName('', 'https://blog.example/feed'), 'blog.example')
  })

  it('drops the country of an edition, unless the site is named after it', () => {
    assert.equal(tidySourceName('Vogue France', 'https://www.vogue.fr/feed'), 'Vogue')
    assert.equal(tidySourceName('Le Soir (Belgique)', 'https://www.lesoir.be/rss'), 'Le Soir')
    assert.equal(tidySourceName('BBC News - UK', 'https://feeds.bbci.co.uk/news/rss.xml'), 'BBC News')
    assert.equal(tidySourceName('Radio France', 'https://www.radiofrance.fr/rss'), 'Radio France')
    assert.equal(tidySourceName('Ouest-France', 'https://www.ouest-france.fr/rss'), 'Ouest-France')
    assert.equal(tidySourceName('France 24', 'https://www.france24.com/fr/rss'), 'France 24')
  })

  it('never takes a feed’s own address for the site’s name', () => {
    assert.equal(tidySourceName('feed.prismamediadigital.com', 'https://www.voici.fr/'), 'voici.fr')
    assert.equal(tidySourceName('voici.fr', 'https://www.voici.fr/'), 'voici.fr')
  })

  it('names a source called after its address from its home page, and only such a source', () => {
    assert.equal(nameFromSite('voici.fr', 'https://voici.fr/', 'Voici'), 'Voici')
    assert.equal(nameFromSite('femmeactuelle.fr', 'https://femmeactuelle.fr/', 'Femme Actuelle'), 'Femme Actuelle')
    assert.equal(nameFromSite('voici.fr', 'https://voici.fr/', 'voici.fr'), null)
    assert.equal(nameFromSite('voici.fr', 'https://voici.fr/', null), null)
    assert.equal(nameFromSite('Le Soir', 'https://lesoir.be/', 'Le Soir Plus'), null)
  })

  it('reads the name a page gives its site', () => {
    assert.equal(siteNameOf('<meta property="og:site_name" content="Le Soir &amp; Co">'), 'Le Soir & Co')
    assert.equal(siteNameOf("<meta content='Voici' name='application-name'>"), 'Voici')
    assert.equal(siteNameOf('<meta property="og:title" content="Un article">'), null)
  })
})
