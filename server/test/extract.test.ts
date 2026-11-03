import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cleanArticleHtml, extractArticle } from '../news/extract.ts'

const lead =
  'Le gouvernement fédéral a présenté ce vendredi son budget pour l’année prochaine, après des semaines de discussions.'

describe('cleanArticleHtml', () => {
  it('removes the RTL info byline, its logo, the "À la une" links and the repeated lead', () => {
    const html = `
      <div>
        <div><img src="https://www.rtl.be/logo-rtl-info.svg" alt="RTL info"><p>par RTL info avec AFP</p>
          <p>Publié le 23 octobre à 17h59</p><p><a href="https://news.google.com">Ajoutez-nous à vos favoris Google</a></p></div>
        <p><strong>${lead}</strong></p>
        <p>${lead} Les partis de la majorité saluent un accord équilibré.</p>
        <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>
        <figure><img src="https://www.rtl.be/photo.jpg" alt="Le Premier ministre"></figure>
        <section><h2>À la une</h2><ul><li><a href="/a">Autre article</a></li><li><a href="/b">Encore un</a></li></ul></section>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /favoris Google|Publié le|par RTL info|logo-rtl|À la une|Autre article/)
    assert.equal(cleaned.split(lead).length - 1, 1)
    assert.match(cleaned, /Les partis de la majorité/)
    assert.match(cleaned, /Un deuxième paragraphe/)
    assert.match(cleaned, /photo\.jpg/)
  })

  it('removes the RTL info author block, tags and sponsored footer', () => {
    const html = `
      <div>
        <figure><img src="https://www.rtl.be/photo.jpg" alt="Tempête"><figcaption>Belga image</figcaption></figure>
        <div>
          <div><img src="https://www.rtl.be/auteurs/celine.jpg" alt="Céline Thérer"></div>
          <span><em>par <a href="/auteurs/celine">Céline Thérer</a></em></span>
          <span>Publié le 24 octobre à 09h00 <a href="https://news.google.com">Ajoutez-nous à vos favoris Google</a></span>
        </div>
        <p>${lead}</p>
        <p>Un deuxième paragraphe avec <a href="/source">une source</a> et la suite de l’article, bien plus long que le lien.</p>
        <div><a href="/belgique">Belgique</a> <a href="/tag/thomas">Thomas de Bergeyck</a></div>
        <div>
          <h2><a href="/sponsorise">Contenus sponsorisés</a></h2>
          <div><a href="/arbres"><img src="https://www.rtl.be/arbres.jpg" alt=""></a></div>
          <h3><a href="/arbres">Arbres déracinés, transports paralysés</a></h3>
          <h3><a href="/fuites">« Il faut se préparer au choc »</a></h3>
        </div>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /Céline|favoris Google|Publié le|Bergeyck|sponsorisés|arbres|Il faut se préparer/i)
    assert.match(cleaned, /photo\.jpg/)
    assert.match(cleaned, /Belga image/)
    assert.match(cleaned, /Un deuxième paragraphe avec <a href="\/source">une source<\/a>/)
    assert.match(cleaned, new RegExp(lead))
  })

  it('removes a numeric date line, as Euronews writes it', () => {
    const html = `
      <div>
        <p>Publié le 25/10/2026 - 16:49 UTC+1</p>
        <p>${lead} Les partis de la majorité saluent un accord équilibré.</p>
        <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /Publié le|UTC/)
    assert.match(cleaned, /Les partis de la majorité/)
  })

  it('removes a bare RTL info byline, its photo and the date run into the repeated lead', () => {
    const html = `
      <div>
        <div><img src="https://www.rtl.be/media/louis.jpg" alt="Louis Vandendriessche"></div>
        <p><em>par <a href="/auteur/louis">Louis Vandendriessche</a></em></p>
        <p>Publié le 25 octobre à 09h06 ${lead}</p>
        <p>${lead} Les partis de la majorité saluent un accord équilibré.</p>
        <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /Vandendriessche|louis\.jpg|Publié le/)
    assert.equal(cleaned.split(lead).length - 1, 1)
    assert.match(cleaned, /Les partis de la majorité/)
    assert.match(cleaned, /Un deuxième paragraphe/)
  })

  it('keeps a paragraph that starts with "par" or mentions a publication date', () => {
    const html =
      '<p>Par ailleurs, le ministre a rappelé que le texte, publié le 3 mars dernier, reste en vigueur pour tous.</p>'

    assert.equal(cleanArticleHtml(`<div>${html}</div>`), html)
  })

  it('removes an author box, its date line and the account prompt from any source', () => {
    const html = `
      <div>
        <p>${lead}</p>
        <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>
        <div>
          <div><img src="https://static.collider.com/w/lucas.jpg" alt="Headshot"></div>
          <p>Published Oct 25, 2026, 5:26 AM EDT</p>
          <p>Lucas Kloberdanz-Dyck is a writer for Collider. He grew up creating lists, stories, and worlds.</p>
          <p><a href="/login">Sign in to your Collider account</a></p>
        </div>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /lucas\.jpg|Published|Kloberdanz|Sign in/)
    assert.match(cleaned, /Un deuxième paragraphe/)
  })

  it('removes an English byline and the date run into the lead', () => {
    const html = `
      <div>
        <p>By Jane Doe</p>
        <p>Updated: October 25, 2026 ${lead}</p>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /Jane Doe|Updated/)
    assert.match(cleaned, new RegExp(`<p>${lead}</p>`))
  })

  it('removes cookie placeholders, "À lire aussi" links, app prompts and the footer after the last rule', () => {
    const html = `
      <div>
        <p>${lead}</p>
        <figure><blockquote><p>Un message important #canal16 <a href="https://t.co/x">pic.twitter.com/abc</a></p>
          — franceinfo (@franceinfo) <a href="https://x.com/franceinfo/status/1">October 26, 2026</a></blockquote>
          <div><p>Ce contenu est bloqué car vous n’avez pas accepté les cookies et autres traceurs.</p>
          <p>En cliquant sur « J’accepte tout », vous consentez aux finalités susmentionnées.</p></div></figure>
        <p><span>À lire aussi :</span><br><a href="/autre">Un autre article de la rédaction sur le même thème</a></p>
        <blockquote><p><strong>Lire aussi : <a href="/guide">la tier list des meilleures Visions</a></strong></p></blockquote>
        <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>
        <div><p><img src="https://example.com/theme/icon.svg" alt="App"></p><p>Toute l'actu tech en un clin d'œil</p>
          <p>Ajoutez Numerama à votre écran d'accueil et restez connectés au futur !</p></div>
        <h3>Nos autres guides :</h3>
        <hr><div><img width="75" height="75" src="https://example.com/tiktok.png" alt="TikTok"><p>TikTok</p></div>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(
      cleaned,
      /cookies|J’accepte|lire aussi|Un autre article|tier list|clin d'œil|écran d'accueil|guides|TikTok|<hr|pic\.twitter/i
    )
    assert.match(cleaned, /<blockquote [^>]*data-network="x"[^>]*data-embed="">/)
    assert.match(cleaned, /Un message important/)
    assert.match(cleaned, /Un deuxième paragraphe/)
  })

  it("removes the page's controls: skip link, sign-up form, follow buttons and a bio split from its name", () => {
    const html = `
      <div>
        <p><a href="https://example.com/article#content"><span>Skip to main content</span></a></p>
        <p>The article starts here, with enough words to be a real paragraph of the text, and then it goes on.</p>
        <p><span><svg aria-label="Follow"><path d="M0 0"/></svg><span>Jay Peters</span></span></p>
        <p><span>is a senior reporter covering technology, gaming, and more.</span></p>
        <ul><li><span><svg aria-label="Follow"><path d="M0 0"/></svg></span><span>Jay Peters</span></li></ul>
        <form><h2>The Daily</h2><p>A free daily digest of the news.</p><label>Email (required)</label></form>
        <ul><li><strong>Création du dossier</strong> : 10 mars 2026</li><li><strong>Dernière mise à jour</strong> : 31 octobre 2026</li></ul>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /Skip to|Jay Peters|senior reporter|The Daily|Email|<form|<ul|dossier|mise à jour/i)
    assert.match(cleaned, /The article starts here/)
  })

  it('drops emphasis covering a whole paragraph, a one-item label list, a date line and related articles', () => {
    const titles = [
      'Premier article de la même série, avec un titre assez long',
      'Deuxième article de la même série, avec un titre long',
      'Troisième article de la même série, avec un titre long'
    ]
    const html = `
      <div>
        <p><span><time datetime="2026-10-30T22:32:53+00:00">Oct 30, 2026, 10:32 PM UTC</time></span></p>
        <p>The article starts here, with enough words to be a real paragraph of the text, and then it goes on.</p>
        <ul><li><em><strong>ARTICLE ORIGINAL</strong></em></li></ul>
        <p><em><strong>Liste du casting :</strong></em></p>
        <blockquote><p><em>La série suit Max, une étudiante en photographie.</em></p></blockquote>
        <hr><h2>Dans le reste de la série</h2>
        <ul>${titles.map(title => `<li><a href="https://example.com/${title.length}">${title}</a></li>`).join('')}</ul>
        <hr><p>Si vous souhaitez contacter l’équipe, envoyez un mail.</p>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /10:32|ARTICLE ORIGINAL|<em>|<strong>|Dans le reste|même série|contacter|<hr/)
    assert.match(cleaned, /<p>Liste du casting :<\/p>/)
    assert.match(cleaned, /<blockquote><p>La série suit Max/)
  })

  it('shows a paragraph of prose set as code as plain text, and keeps real code', () => {
    const cleaned =
      cleanArticleHtml(`<blockquote><p><code>Read this article and any relevant source code, then explore if you could emulate the chip.</code></p></blockquote>
      <p><code>const answer = items.map(item => item.id)</code></p>`)

    assert.match(cleaned, /<p>Read this article/)
    assert.match(cleaned, /<code>const answer/)
  })

  it("removes a live page's status, its edit date and an empty label", () => {
    const cleaned = cleanArticleHtml(`<div><p>En Cours</p><p>Modifié le : 31/10/2026 - 07:42</p><p>Animé par :</p>
      <h2>Le direct</h2><p>Liste des pays :</p><ul><li>Belgique</li><li>France</li></ul>
      <p>The live starts here, with enough words to be a real paragraph of the text, and then it goes on.</p></div>`)

    assert.doesNotMatch(cleaned, /En Cours|Modifié|Animé/)
    assert.match(cleaned, /Liste des pays :/)
  })

  it('keeps a list of shops the article is about', () => {
    const shops = ['Amazon', 'Boulanger', 'Fnac.com', 'Darty']
    const html = `<p>A deals article with enough words to be a real paragraph of the text, and then it goes on.</p>
      <h2>Quels sont les e-commerçants participants ?</h2>
      <ul>${shops.map(shop => `<li><a href="https://example.com/${shop}">${shop}</a></li>`).join('')}</ul>
      <p>The article goes on after the list, with the best deals of the day and how long they last.</p>`

    assert.match(cleanArticleHtml(html), /Boulanger/)
  })

  it("puts an embedded post's author at the top and its date at the foot", () => {
    const cleaned = cleanArticleHtml(`<blockquote><p lang="en">Something worth saying.</p>
      — Jane Doe (@janedoe) <a href="https://x.com/janedoe/status/123">October 30, 2026</a></blockquote>`)

    assert.match(cleaned, /<p data-embed-author=""><strong>Jane Doe<\/strong><span>@janedoe<\/span><\/p>/)
    assert.match(cleaned, /<p data-embed-date="">October 30, 2026<\/p><\/blockquote>/)
    assert.doesNotMatch(cleaned, /—/)
  })

  it('drops what an embed shows while its script loads', () => {
    const html = `
      <div>
        <p>${lead}</p>
        <div><div>Chargement du twitt…</div></div>
        <p>Chargement du tweet...</p>
        <p><span>Loading…</span></p>
        <p>Chargement des camions au port d’Anvers, qui a repris ce matin après trois jours de grève.</p>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /twitt|tweet|Loading/)
    assert.match(cleaned, /Chargement des camions/)
  })

  it('shows lazy images, drops placeholders and icons, sets credits apart and marks long lists of short items', () => {
    const games = Array.from({ length: 9 }, (_, index) => `<li><strong>Jeu ${index + 1}</strong></li>`).join('')
    const html = `
      <div>
        <p>${lead}</p>
        <figure><img src="data:image/svg+xml;utf8,%3Csvg%3E" alt="Dembélé"><figcaption>Ousmane Dembélé</figcaption></figure>
        <figure><img src="https://example.com/mbappe.jpg" alt="Mbappé">
          <figcaption>Kylian Mbappé // Source : <a href="https://x.com/equipedefrance">Compte X</a></figcaption></figure>
        <figure><img src="https://example.com/guide.jpg" alt="Guide"><figcaption>©Gameblog</figcaption></figure>
        <p>Le premier paragraphe de la suite, avec assez de texte pour compter comme tel.</p>
        <ul>${games}</ul>
        <ul><li>Un</li><li>Deux</li></ul>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /data:image|Dembélé|©Gameblog/)
    assert.match(
      cleaned,
      /<figcaption>Kylian Mbappé<small>Source : <a href="https:\/\/x\.com\/equipedefrance">Compte X<\/a><\/small><\/figcaption>/
    )
    assert.match(cleaned, /guide\.jpg/)
    assert.equal(cleaned.split('data-compact').length - 1, 1)
  })

  it('removes a date line with a time zone or in figures', () => {
    for (const line of ['Publié le 26 octobre 2026 - 15:28 UTC+1', 'Publié le : 26/10/2026 - 15:29']) {
      const cleaned = cleanArticleHtml(`<div><p>${line}</p><p>${lead}</p></div>`)
      assert.equal(cleaned, `<p>${lead}</p>`)
    }
  })

  it('leaves a regular article untouched', () => {
    const html = '<p>Premier paragraphe de l’article, assez long pour compter comme du texte.</p><p>Second.</p>'

    assert.equal(cleanArticleHtml(html), html)
  })

  it("keeps only the reader's tags: wrappers go, text alone in one becomes a paragraph", () => {
    const html = `<div class="page"><section><h1>Un titre</h1><div>Un texte posé dans une div, sans paragraphe autour de lui.</div>
      <div><span>Un texte libre</span><p>Un vrai paragraphe, avec <b>du gras</b>, <i>de l’italique</i> et un 1<sup>er</sup>.</p></div>
      <font>Un reste de texte, assez long pour ne pas être une étiquette.</font><p>Fin de l’article.</p></section></div>`

    assert.equal(
      cleanArticleHtml(html).replace(/>\s+</g, '><'),
      '<h2>Un titre</h2><p>Un texte posé dans une div, sans paragraphe autour de lui.</p><p>Un texte libre</p>' +
        '<p>Un vrai paragraphe, avec <strong>du gras</strong>, <em>de l’italique</em> et un 1<sup>er</sup>.</p>' +
        '<p>Un reste de texte, assez long pour ne pas être une étiquette.</p><p>Fin de l’article.</p>'
    )
  })

  it("removes a breadcrumb before the text, the sources and author's section at the end and a picture shown again", () => {
    const cover = '<figure><img src="https://example.com/couronne.jpg" alt="Couronne"></figure>'
    const teaser = '<a href="https://example.com/autre"><img src="https://example.com/couronne.jpg" alt=""></a>'
    const html = `<ol><li><a href="/recettes">Recettes plaisir</a></li></ol>${cover}
      <p>Une couronne de pâte feuilletée garnie de brie, à servir chaude avec l’apéritif du soir.</p>
      <p class="label">Sources</p><ul><li><a href="https://example.com/source">La recette d’origine sur un autre site</a></li></ul>
      <p>À propos de l’auteur</p><p>Ses derniers articles</p>${teaser.repeat(3)}`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /Recettes plaisir/)
    assert.match(cleaned, /Une couronne de pâte feuilletée/)
    assert.doesNotMatch(cleaned, /Sources|La recette d’origine/)
    assert.doesNotMatch(cleaned, /propos de l’auteur|derniers articles/)
    assert.equal(cleaned.match(/couronne\.jpg/g)?.length, 1)
  })

  it('keeps a list of links that comes after the first line of text, and different pictures', () => {
    const html = `<p>Trois sites pour suivre la météo en montagne, choisis par la rédaction cette semaine.</p>
      <ul><li><a href="https://a.example">Météo A</a></li><li><a href="https://b.example">Météo B</a></li></ul>
      <figure><img src="https://example.com/a.jpg"></figure><figure><img src="https://example.com/b.jpg"></figure>`

    const cleaned = cleanArticleHtml(html)

    assert.match(cleaned, /Météo A/)
    assert.match(cleaned, /a\.jpg/)
    assert.match(cleaned, /b\.jpg/)
  })

  it('removes a "Read also" link glued to its label, ad slot labels and a share label', () => {
    const html = `<p>${lead}</p>
      <p><strong>À lire aussi</strong><a href="https://example.com/autre">Un autre sujet de la rédaction</a></p>
      <p>Publicité, votre contenu continue ci-dessous</p>
      <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>
      <p>Partager</p>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /À lire aussi|Un autre sujet|Publicité|Partager/)
    assert.match(cleaned, /Un deuxième paragraphe/)
  })

  it('removes a table of contents and its title, and a title left without its list', () => {
    const html = `<h6>Sommaire</h6><p>${lead}</p>
      <p>Table of Contents</p>
      <ol><li><a href="https://example.com/article#contexte">Le contexte</a></li>
        <li><a href="https://example.com/article#suite">La suite</a></li></ol>
      <h2 id="contexte">Le contexte</h2>
      <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /Sommaire|Table of Contents|La suite/)
    assert.match(cleaned, /<h2[^>]*>Le contexte<\/h2>/)
  })

  it('keeps a list of links to other pages, which is no table of contents', () => {
    const html = `<p>${lead}</p>
      <ul><li><a href="https://a.example/#top">Météo A</a></li><li><a href="https://b.example/#top">Météo B</a></li></ul>
      <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>`

    assert.match(cleanArticleHtml(html), /Météo A/)
  })

  it('removes a rating widget, a cookie wall and a subscriber-only notice', () => {
    const html = `<p>${lead}</p>
      <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>
      <p>As-tu apprécié l’article ?</p><p>you rated this article as good! thanks!</p>
      <p>Pourquoi voyez-vous ce message ?</p>
      <p>Vous avez choisi de ne pas accepter le dépôt de "cookies" sur votre navigateur.</p>
      <p>Cette fonctionnalité est reservée aux abonnés.</p>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /apprécié|rated|Pourquoi|cookies|abonnés/)
    assert.match(cleaned, /Un deuxième paragraphe/)
  })

  it('trims the links ending a text kept in one wrapper, and keeps the text', () => {
    const related = Array.from(
      { length: 8 },
      (_, index) => `<li><a href="/autre-${index}">Un autre sujet de la rédaction, numéro ${index + 1}, à lire</a></li>`
    ).join('')
    const html = `<div><p>${lead}</p>
      <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails. ${lead}</p>
      <p>Un troisième paragraphe, qui conclut l’article et que le lecteur doit pouvoir lire en entier.</p>
      <ul>${related}</ul></div>`

    const cleaned = cleanArticleHtml(html)

    assert.match(cleaned, /Un troisième paragraphe/)
    assert.doesNotMatch(cleaned, /Un autre sujet/)
  })

  it('removes a block of links ending the text with its title', () => {
    const html = `<p>${lead}</p>
      <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>
      <div><p>Les dernières nouveautés chez <a href="/tag/orange">Orange</a></p>
        <ul><li><a href="/a">Une offre fibre à moitié prix ce mois-ci</a></li><li><a href="/b">Le nouveau forfait 5G</a></li></ul></div>
      <p role="heading" aria-level="2">Shorts</p>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /nouveautés|forfait|Shorts/)
    assert.match(cleaned, /Un deuxième paragraphe/)
  })

  it('removes related lists and comments under their titles, and keeps the credit for the text', () => {
    const html = `<p>${lead}</p>
      <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>
      <h2>Vous aimerez aussi</h2><ul><li><a href="/a">Un film à voir</a></li><li><a href="/b">Une série</a></li></ul>
      <h2>Who's behind this story?</h2><p>Jane Doe, science editor since 2021.</p>
      <p>This article is republished from The Conversation under a Creative Commons license.</p>
      <p>Retrouvez tous nos dossiers.</p>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(cleaned, /aimerez|Un film|behind|Jane Doe|dossiers/)
    assert.match(cleaned, /republished from The Conversation/)
  })
})

describe('extractArticle', () => {
  it('turns down a page whose text is too short once its furniture is removed', () => {
    const links = Array.from(
      { length: 12 },
      (_, index) =>
        `<li><a href="/autre-${index}">Un autre sujet de la rédaction, numéro ${index + 1}, à lire aussi</a></li>`
    ).join('')
    const page = `<!doctype html><html><head><title>Vidéo</title></head><body><article><h1>Vidéo</h1>
      <p>Pour afficher ce contenu YouTube, il est nécessaire d'autoriser les cookies de mesure d'audience et de publicité.</p>
      <p>Une extension de votre navigateur semble bloquer le chargement du lecteur vidéo.</p>
      <section><h2>À la une</h2><ul>${links}</ul></section>
    </article></body></html>`

    assert.equal(extractArticle(page, 'https://www.france24.com/fr/video/1'), null)
  })

  it('removes a card labelled as an ad, with its offer', () => {
    const paragraphs = Array.from(
      { length: 4 },
      (_, index) => `<p>${lead} Paragraphe ${index + 1} de l’article, avec ce qu’il faut de détails pour être lu.</p>`
    ).join('')
    const page = `<!doctype html><html><head><title>Budget</title></head><body><article><h1>Budget</h1>
      ${paragraphs}
      <div><div><img src="https://example.com/promo.jpg"></div><div><div>Jusqu’à -20% sur une sélection Gaming !</div>
        <div>Retrouvez une large sélection de produits avec des promos allant jusqu’à -20% !</div>
        <div><div>Sponsorisé</div><a href="https://shop.example.com/offre">J’en profite</a></div></div></div>
      ${paragraphs}
    </article></body></html>`

    const article = extractArticle(page, 'https://www.example.com/budget')

    assert.ok(article)
    assert.doesNotMatch(article.contentHtml, /Gaming|promos|Sponsorisé|promo\.jpg/)
    assert.match(article.contentHtml, /Paragraphe 4/)
  })

  it('reads a text inside a layout named "sidebar" and a share block, with its standfirst (ActuGaming)', () => {
    const body = (subject: string) =>
      `${subject} Les joueurs pourront découvrir la nouvelle carte, les armes et les personnages dès dimanche matin, ` +
      'avec un événement de lancement, des défis quotidiens et une boutique renouvelée pour toute la durée de la saison. ' +
      'Les anciens joueurs retrouveront aussi leurs objets de collection.'
    const promo = Array.from(
      { length: 6 },
      () =>
        'Un jeu gratuit à découvrir sur smartphone, avec ses classes, ses donjons et ses combats tactiques entre amis.'
    ).join(' ')
    const page = `<!doctype html><html><head><title>Fortnite</title></head><body>
      <header class="ag-header"><nav><a href="/">Accueil</a></nav></header>
      <div class="ag-sidebar"><div class="ag-sidebar__content"><article class="ag-post-entry__container">
        <header><h1>Fortnite lance sa nouvelle saison</h1>
          <div class="ag-post__meta-author"><p><a href="https://www.actugaming.net/author/florian/">Florian</a></p></div></header>
        <div class="ag-post-entry__content">
          <div class="ag-post__intro"><p>${body('Le chapeau : la nouvelle saison de Fortnite démarre ce dimanche.')}</p></div>
          <div class="ag-share"><div class="ag-share__bar"><a href="https://x.com/share">X</a></div>
            <div class="ag-share__content"><div class="ag-content">
              <h2 id="h-comment-jouer-a-la-nouvelle-saison">Comment jouer à la nouvelle saison</h2>
              <p>${body('Le corps du texte, premier paragraphe.')}</p>
              <p>${body('Le corps du texte, second paragraphe.')}</p>
            </div></div></div>
        </div>
      </article></div><aside class="ag-sidebar__aside"></aside></div>
      <div class="ag-page__footer"><div class="ag-post__sponsored"><article class="ag-scard">
        <h3>7 raisons de jouer à un jeu sponsorisé</h3><p>${promo}</p></article></div></div>
    </body></html>`

    const article = extractArticle(page, 'https://www.actugaming.net/fortnite-saison-1/')

    assert.ok(article)
    assert.match(article.contentHtml, /Le chapeau/)
    assert.match(article.contentHtml, /second paragraphe/)
    assert.match(article.contentHtml, /Comment jouer à la nouvelle saison/)
    assert.doesNotMatch(article.contentHtml, /7 raisons|smartphone|Florian/)
  })

  it("shows the hidden copy of a live blog's posts, and only there", () => {
    const post = (index: number) =>
      `<div><time>31/10/2026 - 1${index}:00</time><h2>Point de la situation numéro ${index}</h2>
        <p>Message ${index} du direct : les cortèges ont défilé dans plusieurs villes, et le ministère a donné un nouveau
        bilan des interpellations dans la soirée, en saluant le travail des forces de l’ordre.</p></div>`
    const posts = Array.from({ length: 6 }, (_, index) => post(index + 1)).join('')
    const page = `<!doctype html><html><head><title>Direct</title></head><body><main><article><h1>En direct</h1>
      <p>Direct terminé</p><p>1 min Temps de lecture</p>
      <p>${lead}</p>
      <div class="m-em-liveblog" data-liveblog=""><div class="arena-liveblog"></div><div style="display: none">${posts}</div></div>
      <div style="display:none"><p>Texte réservé aux abonnés, qui doit rester caché quelle que soit sa longueur.</p></div>
    </article></main></body></html>`

    const article = extractArticle(page, 'https://www.france24.com/fr/france/direct')

    assert.ok(article)
    assert.match(article.contentHtml, /Message 6 du direct/)
    assert.doesNotMatch(article.contentHtml, /réservé aux abonnés|Direct terminé|Temps de lecture/)
  })

  it('removes a breadcrumb ending on the page itself, the section link and the related blocks (Gamekult)', () => {
    const html = `
      <div>
        <ul><li><a href="/">Accueil</a></li><li><a href="/actualite.html">News</a></li>
          <li>Persona 5 Royal vient de perdre le record du monde du plus long solo</li></ul>
        <p><a href="/actualite.html">news</a></p>
        <p>${lead}</p>
        <p>Un deuxième paragraphe, bien distinct du premier, avec la suite de l’article et ses détails.</p>
        <p>13 images</p>
        <p>Le jeu en rapport</p><p><a href="/jeu/persona-5.html">Persona 5 Royal</a></p>
        <p>Vidéo du moment</p>
        <header><p>Ça vous a intéressé ? En voilà encore !</p></header>
        <ul><li><a href="/news/1.html">Un autre article de la rédaction</a></li></ul>
        <p>Je ne suis pas intéressé, revenir au site</p>
      </div>`

    const cleaned = cleanArticleHtml(html)

    assert.doesNotMatch(
      cleaned,
      /Accueil|record du monde|>news<|13 images|en rapport|Vidéo du moment|intéressé|autre article/
    )
    assert.match(cleaned, /Un deuxième paragraphe/)
  })
})
