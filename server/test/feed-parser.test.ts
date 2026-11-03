import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Source } from '../news/catalog.ts'
import { parseFeed, parseFeedEntries } from '../news/feed-parser.ts'

const source = (kind: Source['kind']): Source => ({
  id: 'test',
  name: 'Test',
  url: 'https://example.com/feed',
  kind,
  lang: 'fr',
  domains: ['example.com']
})

describe('parseFeed', () => {
  it('reads RSS items with a clean link, a summary, a date and an image', () => {
    const [item] = parseFeed(
      `<?xml version="1.0"?>
      <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
        <item>
          <title>Le budget &amp; la dette</title>
          <link>https://example.com/budget?utm_source=rss#top</link>
          <pubDate>Fri, 23 Oct 2026 07:00:00 +0200</pubDate>
          <description><![CDATA[<p>Le <b>gouvernement</b> présente son budget.</p>]]></description>
          <enclosure url="https://example.com/budget.jpg" type="image/jpeg" length="1" />
        </item>
      </channel></rss>`,
      source('article')
    )

    assert.equal(item?.title, 'Le budget & la dette')
    assert.equal(item?.link, 'https://example.com/budget')
    assert.equal(item?.summary, 'Le gouvernement présente son budget.')
    assert.equal(item?.publishedAt, '2026-10-23T05:00:00.000Z')
    assert.equal(item?.image, 'https://example.com/budget.jpg')
    assert.equal(item?.media, null)
    assert.match(item?.id ?? '', /^[\w-]{16}$/)
  })

  it('drops the copy of an article in another language than the source', () => {
    const items = parseFeed(
      `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <item>
          <title>Sept idées déco qui vieillissent mal et que l’on regrette d’avoir choisies</title>
          <link>https://example.com/fr/idees</link>
          <description>Une image parfaite sur Pinterest ne garantit pas une maison agréable à vivre.</description>
        </item>
        <item>
          <title>7 decorating ideas that don’t stand the test of time, and that you’ll regret choosing</title>
          <link>https://example.com/en/ideas</link>
          <description>A perfect image on Pinterest doesn’t guarantee a home that’s pleasant to live in.</description>
        </item>
        <item>
          <title>iPhone 18 Pro : Apple dévoile son nouveau Face ID</title>
          <link>https://example.com/fr/iphone</link>
        </item>
      </channel></rss>`,
      source('article')
    )

    assert.deepEqual(
      items.map(item => item.link),
      ['https://example.com/fr/idees', 'https://example.com/fr/iphone']
    )
  })

  it('keeps every article of a feed in one language, even when the source says another', () => {
    const items = parseFeed(
      `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <item>
          <title>The best games of the year and why they matter to all of us</title>
          <link>https://example.com/games</link>
        </item>
      </channel></rss>`,
      source('article')
    )

    assert.equal(items.length, 1)
  })

  it('reads YouTube Atom entries as videos', () => {
    const items = parseFeed(
      `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
        <entry>
          <yt:videoId>dQw4w9WgXcQ</yt:videoId>
          <yt:channelId>UCuAXFkgsw1L7xaCfnd5JJOw</yt:channelId>
          <title>Les infos du jour</title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
          <published>2026-10-23T06:00:00+00:00</published>
          <media:group>
            <media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" width="480" height="360"/>
            <media:description>Le résumé de l'actualité.</media:description>
          </media:group>
        </entry>
        <entry>
          <yt:videoId>aBcDeFgHiJk</yt:videoId>
          <title>Un short</title>
          <link rel="alternate" href="https://www.youtube.com/shorts/aBcDeFgHiJk"/>
          <published>2026-10-23T07:00:00+00:00</published>
        </entry>
      </feed>`,
      source('video')
    )

    // Shorts are left out.
    assert.equal(items.length, 1)
    assert.deepEqual(items[0]?.media, {
      type: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw'
    })
    assert.equal(items[0]?.image, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    assert.equal(items[0]?.summary, "Le résumé de l'actualité.")
  })

  it('reads podcast enclosures and skips episodes without audio', () => {
    const items = parseFeed(
      `<?xml version="1.0"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
        <item>
          <title>Journal de 8h</title>
          <guid isPermaLink="false">episode-1</guid>
          <link>https://example.com/journal-8h</link>
          <enclosure url="https://cdn.example.com/journal.mp3" type="audio/mpeg" length="1000" />
          <itunes:duration>12:30</itunes:duration>
        </item>
        <item>
          <title>Annonce sans audio</title>
          <link>https://example.com/annonce</link>
        </item>
      </channel></rss>`,
      source('podcast')
    )

    assert.equal(items.length, 1)
    assert.deepEqual(items[0]?.media, {
      type: 'audio',
      url: 'https://cdn.example.com/journal.mp3',
      durationSeconds: 750
    })
  })

  it('upgrades http links to https and drops other schemes', () => {
    const items = parseFeed(
      `<rss version="2.0"><channel>
        <item><title>Ancien lien</title><link>http://example.com/a</link></item>
        <item><title>Script</title><link>javascript:alert(1)</link></item>
        <item><title>Fichier</title><link>ftp://example.com/b</link></item>
      </channel></rss>`,
      source('article')
    )

    assert.deepEqual(
      items.map(item => item.link),
      ['https://example.com/a']
    )
  })

  it('keeps the full article HTML of content:encoded out of the item', () => {
    const [entry] = parseFeedEntries(
      `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
        <item>
          <title>Article complet</title>
          <link>https://example.com/complet</link>
          <description>Court résumé</description>
          <content:encoded><![CDATA[<p>Le texte <em>complet</em>.</p>]]></content:encoded>
        </item>
      </channel></rss>`,
      source('article')
    )

    assert.equal(entry?.contentHtml, '<p>Le texte <em>complet</em>.</p>')
    assert.equal(entry?.item.summary, 'Court résumé')
    assert.equal('contentHtml' in (entry?.item ?? {}), false)
  })

  it('summarizes a whole page pasted in a description with its first paragraph', () => {
    const [item] = parseFeed(
      `<rss version="2.0"><channel>
        <item>
          <title>Page complète</title>
          <link>https://example.com/page</link>
          <description><![CDATA[<header><nav><a href="/">Accueil</a> <a href="/info">Info</a></nav></header>
            <p>Publié le 23/10</p>
            <figure><img src="/photo.jpg"><figcaption>Une légende</figcaption></figure>
            <p>Le conseil communal a voté ce mardi un budget en hausse pour les écoles de la commune.</p>
            <p>Deuxième paragraphe.</p>
            <footer>Tous droits réservés</footer>]]></description>
        </item>
      </channel></rss>`,
      source('article')
    )

    assert.equal(
      item?.summary,
      'Le conseil communal a voté ce mardi un budget en hausse pour les écoles de la commune.'
    )
    // Page chrome images are often logos: the article page's share image is used instead.
    assert.equal(item?.image, null)
  })

  it('takes the first image of the article HTML when the feed has no media tag', () => {
    const [item, plainHttp] = parseFeed(
      `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
        <item>
          <title>WordPress</title>
          <link>https://example.com/wp</link>
          <description>Résumé</description>
          <content:encoded><![CDATA[<p><img src="https://cdn.example.com/a.jpg?w=800&amp;h=600" /></p><p>Texte</p>]]></content:encoded>
        </item>
        <item>
          <title>Image en clair</title>
          <link>https://example.com/http</link>
          <description>Résumé</description>
          <content:encoded><![CDATA[<img src="http://example.com/b.jpg"><p>Texte</p>]]></content:encoded>
        </item>
      </channel></rss>`,
      source('article')
    )

    assert.equal(item?.image, 'https://cdn.example.com/a.jpg?w=800&h=600')
    assert.equal(plainHttp?.image, null)
  })

  it('skips items flagged for subscribers only', () => {
    const items = parseFeed(
      `<rss version="2.0" xmlns:dcterms="http://purl.org/dc/terms/"><channel>
        <item><title>Gratuit</title><link>https://example.com/a</link><dcterms:accessRights>FREE</dcterms:accessRights></item>
        <item><title>Payant</title><link>https://example.com/b</link><dcterms:accessRights>PAYING</dcterms:accessRights></item>
        <item><title>Membre</title><link>https://example.com/c</link><dcterms:accessRights>MEMBER</dcterms:accessRights></item>
        <item><title>Sans mention</title><link>https://example.com/d</link></item>
      </channel></rss>`,
      source('article')
    )

    assert.deepEqual(
      items.map(item => item.title),
      ['Gratuit', 'Sans mention']
    )
  })

  it('rejects documents that are not feeds', () => {
    assert.throws(() => parseFeed('<html><body>Not a feed</body></html>', source('article')), /Not an RSS or Atom feed/)
  })
})
