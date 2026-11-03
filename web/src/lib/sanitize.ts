import DOMPurify from 'dompurify'
import { inlineImageSrcSet } from './article-image.ts'

// Article HTML comes from third-party sites: the server extracts it with Readability,
// and the browser sanitizes it again here before showing it.
const purify = DOMPurify(window)

// The article being sanitized, while sanitizeArticle runs: its pictures come smaller from the server.
let pictures: string | null = null

purify.addHook('uponSanitizeAttribute', (node, data) => {
  // Plain http images would be blocked as mixed content anyway.
  if (node.tagName === 'IMG' && data.attrName === 'src' && !data.attrValue.startsWith('https://')) {
    data.keepAttr = false
  }
})

purify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }

  // A picture's size only gives its proportions (the column's styles set how wide it shows), so the reader keeps its
  // place before it loads. Any other size, or one that is not a number of pixels, goes.
  const sized =
    /^\d{1,5}$/.test(node.getAttribute('width') ?? '') && /^\d{1,5}$/.test(node.getAttribute('height') ?? '')
  if (node.tagName !== 'IMG' || !sized) {
    node.removeAttribute('width')
    node.removeAttribute('height')
  }

  if (node.tagName === 'IMG') {
    node.setAttribute('loading', 'lazy')
    // Numbered by the server (data-image): the browser takes the width the column needs from the server's copies,
    // and the reader goes back to the site's picture (src) if they fail.
    const index = node.getAttribute('data-image')
    if (pictures && index && /^\d{1,3}$/.test(index) && node.hasAttribute('src')) {
      node.setAttribute('srcset', inlineImageSrcSet(pictures, Number(index)))
      node.setAttribute('sizes', '(max-width: 640px) 100vw, 640px')
    }
  }
})

export const sanitizeArticle = (html: string, articleId?: string) => {
  pictures = articleId ?? null
  try {
    return purify.sanitize(html, {
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio', 'svg'],
      FORBID_ATTR: ['style', 'class', 'id', 'srcset', 'sizes']
    })
  } finally {
    pictures = null
  }
}
