import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decodeEntities, htmlToText } from '../news/text.ts'

describe('text', () => {
  it('decodes every character reference as a browser does', () => {
    assert.equal(decodeEntities('&Eacute;t&eacute; &agrave; Li&egrave;ge'), 'Été à Liège')
    assert.equal(decodeEntities('&oelig;uvre &Ccedil;a &shy;&trade; &frac12;'), 'œuvre Ça ­™ ½')
    assert.equal(decodeEntities('&#233;&#xE9;&#X1F600;'), 'éé😀')
    assert.equal(decodeEntities('AT&T &amp; co &copy 2026'), 'AT&T & co © 2026')
    assert.equal(decodeEntities('&unknown; &#0;'), '&unknown; \uFFFD')
  })

  it('makes plain text of a snippet', () => {
    assert.equal(htmlToText('<p>L&rsquo;&eacute;t&eacute;&nbsp;indien</p><script>x()</script>'), 'L’été indien')
  })
})
