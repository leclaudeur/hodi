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
})
