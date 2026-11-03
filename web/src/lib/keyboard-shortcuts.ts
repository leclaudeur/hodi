import { useEffect } from 'react'
import { searchHref } from './use-hash-route.ts'

// Keys for reading on a computer. They act on what the page shows (cards, the reader's buttons),
// found by their data-card / data-reader / data-shortcut marks, so no view needs to know about them.
// What each does is shortcuts.<id> in the locale files, under its group's heading (shortcuts.groups.<group>).
export interface Shortcut {
  keys: string[]
  id: string
  group: 'navigate' | 'article'
}

export const SHORTCUT_GROUPS: Shortcut['group'][] = ['navigate', 'article']

// "escape" is the Escape key, named in the interface's language.
export const SHORTCUTS = [
  { keys: ['J'], id: 'next', group: 'navigate' },
  { keys: ['K'], id: 'previous', group: 'navigate' },
  { keys: ['↵'], id: 'open', group: 'navigate' },
  { keys: ['H'], id: 'previousTopic', group: 'navigate' },
  { keys: ['L'], id: 'nextTopic', group: 'navigate' },
  { keys: ['/'], id: 'search', group: 'navigate' },
  { keys: ['S'], id: 'save', group: 'article' },
  { keys: ['M'], id: 'hide', group: 'navigate' },
  { keys: ['R'], id: 'summary', group: 'article' },
  { keys: ['N'], id: 'nextArticle', group: 'article' },
  { keys: ['B'], id: 'back', group: 'article' },
  { keys: ['?'], id: 'help', group: 'article' },
  { keys: ['escape'], id: 'close', group: 'article' }
] as const satisfies Shortcut[]

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

const click = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector)
  element?.click()
  return element !== null
}

const isOnScreen = (card: HTMLElement) => {
  const { top, bottom } = card.getBoundingClientRect()
  return bottom > 0 && top < window.innerHeight
}

// Focuses the next or previous card. With none focused, or the focused one scrolled out of sight
// (the list moved with the mouse), it starts from the cards on screen rather than jumping back.
const moveCard = (step: number) => {
  const cards = [...document.querySelectorAll<HTMLElement>('[data-card]')]
  if (cards.length === 0) return false

  const focused = cards.findIndex(card => card.contains(document.activeElement))
  const onScreen = cards.filter(isOnScreen)
  const next =
    focused !== -1 && isOnScreen(cards[focused]!)
      ? cards[focused + step]
      : step > 0
        ? (onScreen[0] ?? cards[0])
        : (onScreen.at(-1) ?? cards.at(-1))
  const link = next?.querySelector<HTMLElement>('a')
  if (!link) return false

  link.focus({ preventScroll: true })
  link.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return true
}

const moveTab = (step: number) => {
  const tabs = [...document.querySelectorAll<HTMLAnchorElement>('[data-tabs] a')]
  const current = tabs.findIndex(tab => tab.getAttribute('aria-current') === 'page')
  const next = current === -1 ? undefined : tabs[current + step]
  if (!next) return false

  window.location.hash = next.getAttribute('href') ?? ''
  return true
}

const saveFocusedOrOpen = () => {
  const card = document.activeElement?.closest('[data-card]')
  const button = (card ?? document.querySelector('[data-reader]'))?.querySelector<HTMLElement>('button[aria-pressed]')
  button?.click()
  return Boolean(button)
}

// "Masquer" on the focused card; the next card takes the focus, so M can go down a list.
const dismissFocused = () => {
  const card = document.activeElement?.closest<HTMLElement>('[data-card]')
  const button = card?.querySelector<HTMLElement>('[data-dismiss]')
  if (!card || !button) return false

  const cards = [...document.querySelectorAll<HTMLElement>('[data-card]')]
  const next = cards[cards.indexOf(card) + 1]
  button.click()
  next?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true })
  return true
}

export const useKeyboardShortcuts = (onHelp: () => void) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || isTyping(event.target)) return
      // A dialog (the video player, this help) keeps its own keys.
      if (document.querySelector('dialog[open]')) return

      const inReader = document.querySelector('[data-reader]') !== null
      const handled = (() => {
        switch (event.key) {
          case 'j':
            return moveCard(1)
          case 'k':
            return moveCard(-1)
          // The arrows scroll an open article; elsewhere they move through the list.
          case 'ArrowDown':
            return !inReader && moveCard(1)
          case 'ArrowUp':
            return !inReader && moveCard(-1)
          case 'l':
            return !inReader && moveTab(1)
          case 'h':
            return !inReader && moveTab(-1)
          case 's':
            return saveFocusedOrOpen()
          case 'm':
            return !inReader && dismissFocused()
          case 'r':
            return click('[data-shortcut="summarize"]')
          case 'n':
            return click('[data-shortcut="next"]')
          case 'b':
          case 'Escape':
            return click('[data-shortcut="back"]')
          case '/':
            window.location.hash = searchHref()
            return true
          case '?':
            onHelp()
            return true
          default:
            return false
        }
      })()

      if (handled) event.preventDefault()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onHelp])
}
