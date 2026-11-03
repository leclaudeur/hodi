import type { TopicItem } from '../api.ts'

// The list an article was opened from (a topic, the front page, a search, the saved articles),
// so the reader can offer the next one. Kept for this tab only.
const STORAGE_KEY = 'hodi:reading-list'
// The last article of the list that was open: one reached from it ("Aussi couvert par") is followed by its next.
const LAST_KEY = 'hodi:reading-last'

// The articles themselves, for the reader's "Article suivant" card (the fil's card), without their related
// sources. Lists kept before they held whole articles are dropped.
export type ListedArticle = Omit<TopicItem, 'related'>

let list: ListedArticle[] | null = null
let last: string | null = null

const store = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Private browsing: the list only lasts while the app stays open.
  }
}

const load = (): ListedArticle[] => {
  if (list) return list

  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]')
    list = Array.isArray(parsed) ? (parsed as ListedArticle[]).filter(article => 'link' in article) : []
  } catch {
    list = []
  }

  return list
}

// Every article opens in the reader, those read on their site too (their summary and a link). Videos and
// episodes have their own player.
export const rememberList = (items: TopicItem[]) => {
  list = items.filter(item => item.kind === 'article').map(({ related: _related, ...article }) => article)
  last = null
  store(STORAGE_KEY, JSON.stringify(list))
  store(LAST_KEY, '')
}

export const nextArticle = (id: string): ListedArticle | null => {
  const articles = load()
  const index = articles.findIndex(article => article.id === id)
  if (index !== -1) {
    if (last !== id) {
      last = id
      store(LAST_KEY, id)
    }
    return articles[index + 1] ?? null
  }

  // Not in the list: another source of the article open before, or one opened from a notification or a link.
  try {
    last ??= sessionStorage.getItem(LAST_KEY) || null
  } catch {
    // Kept in memory only.
  }
  const from = articles.findIndex(article => article.id === last)
  return from === -1 ? null : (articles[from + 1] ?? null)
}
