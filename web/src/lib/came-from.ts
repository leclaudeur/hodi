// Mon compte and the catalogue are pages of their own, opened from anywhere in the app: their back button returns
// to the address they were opened from, not to a fixed page.
const PAGES = ['#/account', '#/catalogue'] as const
type Page = (typeof PAGES)[number]

const pageOf = (hash: string): Page | undefined => PAGES.find(page => hash === page || hash.startsWith(`${page}/`))

const openedFrom = new Map<Page, string>()

// Moving between a page's own sections keeps where it was opened from, and so does going back: from Mon compte back
// to the catalogue it was opened from, the catalogue keeps its own origin rather than pointing at Mon compte.
export const recordMove = (from: string, to: string) => {
  const left = pageOf(from)
  if (left && openedFrom.get(left) === to) return
  const page = pageOf(to)
  if (page && left !== page) openedFrom.set(page, from || '#/')
}

const hashOf = (url: string) => new URL(url).hash

export const watchCameFrom = () =>
  window.addEventListener('hashchange', event => recordMove(hashOf(event.oldURL), hashOf(event.newURL)))

// Opened straight from its address, a page has nowhere to return to but its fallback.
export const backTo = (page: Page, fallback: string) => openedFrom.get(page) ?? fallback
