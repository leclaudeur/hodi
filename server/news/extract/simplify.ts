import { type Element, normalized } from './dom.ts'

// The reader's whole vocabulary: text blocks, lists, headings, links, quotes, pictures with their captions,
// inline emphasis, code and tables. Any other tag (div, span, section, font…) goes and its content stays; a
// wrapper holding only text becomes a paragraph. The groups and cards Hodi builds itself are kept as they are.
const KEPT_TAGS = new Set([
  'p',
  'ul',
  'ol',
  'li',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'blockquote',
  'figure',
  'figcaption',
  'img',
  'strong',
  'em',
  'br',
  'small',
  'sup',
  'sub',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption'
])
const RENAMED_TAGS: Record<string, string> = { b: 'strong', i: 'em', h1: 'h2' }
const DROPPED_TAGS = new Set([
  'hr',
  'source',
  'svg',
  'button',
  'input',
  'select',
  'textarea',
  'nav',
  'script',
  'style',
  'video',
  'audio',
  'iframe',
  'object',
  'embed'
])
const BLOCK_CHILDREN =
  'p, ul, ol, h2, h3, h4, h5, h6, blockquote, figure, table, pre, div, section, article, aside, header, footer, main'
// Places where a run of text is fine as it is, with no paragraph around it.
const INLINE_HOME = 'p, li, h2, h3, h4, h5, h6, td, th, caption, figcaption, a, strong, em, small, sup, sub, code, pre'

const isOwnBlock = (element: Element) =>
  element.matches('[data-gallery], [data-embed-author], [data-embed-date]') ||
  (element.tagName === 'SPAN' && element.closest('a[data-embed-card], [data-embed-author]') !== null)

const isInlineNode = (node: Element['childNodes'][number]) =>
  node.nodeType === 3 || (node.nodeType === 1 && !(node as unknown as Element).matches(BLOCK_CHILDREN))

// Runs of text and inline tags between blocks get a paragraph each, so no text floats between blocks.
const wrapInlineRuns = (container: Element) => {
  let run: Element['childNodes'][number][] = []
  const flush = (before: Element['childNodes'][number] | null) => {
    if (
      run.some(
        node =>
          normalized(node.textContent) !== '' || (node.nodeType === 1 && (node as unknown as Element).matches('img'))
      )
    ) {
      // Blank space around the run stays outside the paragraph.
      const isBlank = (node: Element['childNodes'][number]) =>
        node.nodeType === 3 && normalized(node.textContent) === ''
      while (run.length > 0 && isBlank(run[0] as Element['childNodes'][number])) run.shift()
      while (run.length > 0 && isBlank(run[run.length - 1] as Element['childNodes'][number])) run.pop()
      const paragraph = container.ownerDocument.createElement('p')
      container.insertBefore(paragraph, before)
      paragraph.append(...run)
    }
    run = []
  }
  for (const node of [...container.childNodes]) {
    if (isInlineNode(node)) run.push(node)
    else flush(node)
  }
  flush(null)
}

export const simplifyTags = (root: Element) => {
  for (const element of [...root.querySelectorAll('*')].reverse()) {
    const tag = element.tagName.toLowerCase()
    if (KEPT_TAGS.has(tag) || isOwnBlock(element)) continue
    if (DROPPED_TAGS.has(tag)) {
      element.remove()
      continue
    }
    const renamed = RENAMED_TAGS[tag]
    const parent = element.parentElement
    if (
      renamed ||
      (!element.querySelector(BLOCK_CHILDREN) &&
        parent &&
        !parent.closest(INLINE_HOME) &&
        normalized(element.textContent) !== '' &&
        /^(div|section|article|aside|header|footer|main|center|details|summary|dl|dd|dt|address)$/.test(tag))
    ) {
      // A heading or emphasis under its standard name; a wrapper of text alone, a paragraph.
      const replacement = element.ownerDocument.createElement(renamed ?? 'p')
      replacement.append(...element.childNodes)
      element.replaceWith(replacement)
      continue
    }
    if (element.querySelector(BLOCK_CHILDREN) && !element.closest(INLINE_HOME)) wrapInlineRuns(element)
    element.replaceWith(...element.childNodes)
  }
  wrapInlineRuns(root)
}
