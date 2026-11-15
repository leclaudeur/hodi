import type { parseHTML } from 'linkedom'
import { SMALL_BLOCK } from './patterns.ts'

export type Element = ReturnType<ReturnType<typeof parseHTML>['document']['createElement']>
type TextNode = ReturnType<ReturnType<typeof parseHTML>['document']['createTextNode']>

export const normalizedText = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
export const normalized = (value: string | null | undefined) => normalizedText(value).toLowerCase()

export const linkTextRatio = (element: Element) => {
  const total = normalized(element.textContent).length
  const linked = [...element.querySelectorAll('a')].reduce(
    (length, link) => length + normalized(link.textContent).length,
    0
  )
  return total === 0 ? 0 : linked / total
}

// The largest small block around an element, so the whole byline goes, not one line of it.
export const smallestEnclosingBlock = (element: Element, root: Element) => {
  let block: Element = element

  while (
    block.parentElement &&
    block.parentElement !== root &&
    normalized(block.parentElement.textContent).length <= SMALL_BLOCK
  ) {
    block = block.parentElement
  }

  return block
}

// The element with its wrappers: the outermost ancestor holding nothing more than it.
export const withWrappers = (element: Element, root: Element) => {
  let block = element
  const text = normalized(element.textContent)
  while (block.parentElement && block.parentElement !== root && normalized(block.parentElement.textContent) === text) {
    block = block.parentElement
  }
  return block
}

// The first piece of text in an element, skipping empty ones.
export const firstTextNode = (element: Element): TextNode | null => {
  for (const child of [...element.childNodes]) {
    if (child.nodeType === 3) {
      if ((child.textContent ?? '').trim() !== '') return child as unknown as TextNode
    } else if (child.nodeType === 1) {
      const found = firstTextNode(child as unknown as Element)
      if (found) return found
      if (normalized(child.textContent) !== '') return null
    }
  }
  return null
}
