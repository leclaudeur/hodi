import type { parseHTML } from 'linkedom'

type Document = ReturnType<typeof parseHTML>['document']

interface StoryElement {
  type?: unknown
  content?: unknown
  level?: unknown
  items?: StoryElement[]
}

interface ArcStory {
  restrictions?: { isRestricted?: unknown }
  story_elements?: StoryElement[]
}

const GLOBAL_CONTENT = 'Fusion.globalContent='

// The JSON value that starts at `start`: its end is the brace that closes the first one, outside strings.
const jsonAt = (text: string, start: number) => {
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (char === '\\') index++
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, index + 1)) as unknown
      } catch {
        return null
      }
    }
  }
  return null
}

const escapeText = (value: string) => value.replace(/</g, '&lt;')

const elementHtml = ({ type, content, level, items }: StoryElement): string => {
  if (type === 'list' && Array.isArray(items))
    return `<ul>${items.map(item => `<li>${elementHtml(item).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>`
  if (typeof content !== 'string' || content.trim() === '') return ''
  if (type === 'text') return `<p>${content}</p>`
  if (type === 'header') return `<h${level === 3 ? 3 : 2}>${escapeText(content)}</h${level === 3 ? 3 : 2}>`
  return ''
}

// Sites built on Arc XP (La Libre, DH) send the start of a free article as HTML and the rest only as data, for their
// script to show: the whole story is read from that data. A restricted story (a subscriber's) is never read.
export const arcStoryHtml = (document: Document) => {
  for (const script of [...document.querySelectorAll('script')]) {
    const text = script.textContent ?? ''
    const at = text.indexOf(GLOBAL_CONTENT)
    if (at < 0) continue
    const story = jsonAt(text, at + GLOBAL_CONTENT.length) as ArcStory | null
    if (!story || story.restrictions?.isRestricted !== false || !Array.isArray(story.story_elements)) return null
    const html = story.story_elements.map(elementHtml).join('')
    return html === '' ? null : html
  }
  return null
}

// The story's own text, when it holds more than what the page showed.
export const fullerText = (story: string | null, shownText: string) =>
  story !== null && plainLength(story) > plainLength(shownText) ? story : null

const plainLength = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length
