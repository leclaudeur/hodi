import { describe, expect, it } from 'vitest'
import { sanitizeArticle } from '../src/lib/sanitize.ts'

// The sanitized HTML as a page, to read it back.
const page = (html: string, articleId?: string) => {
  const root = document.createElement('div')
  root.innerHTML = sanitizeArticle(html, articleId)
  return root
}

describe('article sanitizer', () => {
  it('removes scripts, styles, forms, frames and event handlers', () => {
    const root = page(
      '<p onclick="steal()">Texte</p><script>steal()</script><style>p{}</style><form><input></form>' +
        '<iframe src="https://evil.example"></iframe><svg><circle/></svg>'
    )
    expect(root.innerHTML).toBe('<p>Texte</p>')
  })

  it('removes the site’s classes, ids and inline styles', () => {
    expect(page('<p class="x" id="y" style="color:red">Texte</p>').innerHTML).toBe('<p>Texte</p>')
  })

  it('removes javascript links and opens the others in a new tab', () => {
    const root = page('<a href="javascript:steal()">a</a><a href="https://site.example/x">b</a>')
    const [bad, good] = [...root.querySelectorAll('a')]
    expect(bad?.hasAttribute('href')).toBe(false)
    expect(good?.getAttribute('target')).toBe('_blank')
    expect(good?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('keeps only https pictures, loaded lazily', () => {
    const root = page('<img src="http://site.example/a.jpg"><img src="https://site.example/b.jpg">')
    const [plain, secure] = [...root.querySelectorAll('img')]
    expect(plain?.hasAttribute('src')).toBe(false)
    expect(secure?.getAttribute('src')).toBe('https://site.example/b.jpg')
    expect(secure?.getAttribute('loading')).toBe('lazy')
  })

  it('keeps a picture’s size in pixels, and no other size', () => {
    const root = page(
      '<img src="https://s.example/a.jpg" width="640" height="360"><img src="https://s.example/b.jpg" width="100%" height="50">' +
        '<table width="600" height="20"><tbody><tr><td>x</td></tr></tbody></table>'
    )
    const [sized, relative] = [...root.querySelectorAll('img')]
    expect([sized?.getAttribute('width'), sized?.getAttribute('height')]).toEqual(['640', '360'])
    expect(relative?.hasAttribute('width')).toBe(false)
    expect(relative?.hasAttribute('height')).toBe(false)
    expect(root.querySelector('table')?.hasAttribute('width')).toBe(false)
  })

  it('points a numbered picture to the server’s smaller copies of that article', () => {
    const root = page(
      '<img src="https://s.example/a.jpg" data-image="2" srcset="https://evil.example/x.jpg 1x">',
      'abc'
    )
    const picture = root.querySelector('img')
    expect(picture?.getAttribute('srcset')).toBe(
      '/api/images/abc/2/240 240w, /api/images/abc/2/480 480w, /api/images/abc/2/960 960w'
    )
    expect(picture?.getAttribute('sizes')).toBe('(max-width: 640px) 100vw, 640px')
  })

  it('never takes a site’s own srcset, nor a copy for a picture it did not number', () => {
    const root = page('<img src="https://s.example/a.jpg" srcset="https://evil.example/x.jpg 1x">', 'abc')
    expect(root.querySelector('img')?.hasAttribute('srcset')).toBe(false)
    // Without an article, no copy either: the next article does not inherit the last one's pictures.
    const later = page('<img src="https://s.example/a.jpg" data-image="1">')
    expect(later.querySelector('img')?.hasAttribute('srcset')).toBe(false)
  })

  // Known ways around sanitizers, from the security audit: none may leave something that runs.
  it.each([
    '<img src=x onerror=alert(1)>',
    '<IMG SRC="jav&#x09;ascript:alert(1)">',
    '<a href="JaVaScRiPt:alert(1)">a</a>',
    '<a href=" javascript:alert(1)">a</a>',
    '<a href="java\u0000script:alert(1)">a</a>',
    '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">a</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">a</a>',
    '<a href="vbscript:msgbox(1)">a</a>',
    '<svg><script>alert(1)</script></svg>',
    '<svg onload=alert(1)>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    '<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<details open ontoggle=alert(1)>',
    '<video><source onerror=alert(1)></video>',
    '<body onload=alert(1)>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<object data="javascript:alert(1)"></object>',
    '<embed src="javascript:alert(1)">',
    '<base href="javascript:/">',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    '<link rel="stylesheet" href="https://evil.example/x.css">',
    '<p style="background:url(javascript:alert(1))">x</p>',
    '<input autofocus onfocus=alert(1)>',
    '<button formaction="javascript:alert(1)">x</button>',
    '<template><img src=x onerror=alert(1)></template>',
    '<div id="x" name="cookie"><a id="x" name="y"></a></div>',
    '<img src="https://s.example/a.jpg" srcset="javascript:alert(1) 1x">'
  ])('leaves nothing that runs in %s', html => {
    const root = page(html)
    for (const element of root.querySelectorAll('*')) {
      expect([
        'script',
        'iframe',
        'object',
        'embed',
        'base',
        'meta',
        'link',
        'style',
        'form',
        'input',
        'button'
      ]).not.toContain(element.localName)
      for (const { name, value } of element.attributes) {
        expect(name.startsWith('on')).toBe(false)
        // A name may stay, but never one that hides what the page's own code reads on document.
        if (name === 'name') expect(value in document).toBe(false)
        expect(['id', 'style', 'srcdoc', 'formaction']).not.toContain(name)
        expect(value.replace(/\s/g, '').replaceAll(String.fromCharCode(0), '').toLowerCase()).not.toMatch(
          /^(javascript|vbscript|data):/
        )
      }
    }
  })
})
