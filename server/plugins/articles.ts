// What plugins may know of the articles Hodi lists: the item and its reader text, never the household's reading.
// Typed apart from the news service on purpose: the plugin SDK's types are built from this file and the registry.

interface ListedItem {
  id: string
  title: string
  link: string
  sourceId: string
  sourceName: string
  publishedAt: string | null
}

// The news service's ArticleResult, as much of it as plugins get.
export type LoadedArticle =
  | { status: 'unknown' }
  | { status: 'failed' | 'unreadable'; item: ListedItem }
  | {
      status: 'ok'
      item: ListedItem
      article: { title: string | null; byline: string | null; contentHtml: string; textLength: number }
    }

export interface PluginArticle {
  id: string
  title: string
  // Its address on its site.
  url: string
  sourceId: string
  sourceName: string
  publishedAt: string | null
  // ok: the reader shows its text. unreadable: no text could be taken from the page (or the source opens on its
  // site). failed: the site did not answer, or refused.
  status: 'ok' | 'unreadable' | 'failed'
  // The reader's text, when there is one.
  text: { title: string | null; byline: string | null; contentHtml: string; textLength: number } | null
}

export interface PluginArticles {
  // An article a source listed, as the reader shows it; null for an id Hodi never listed.
  get: (id: string) => Promise<PluginArticle | null>
  // Its page as the site serves it now, fetched again; null when it cannot be had.
  page: (id: string) => Promise<{ url: string; html: string } | null>
}

export const pluginArticle = (result: LoadedArticle): PluginArticle | null => {
  if (result.status === 'unknown') return null
  const { item } = result
  return {
    id: item.id,
    title: item.title,
    url: item.link,
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    publishedAt: item.publishedAt,
    status: result.status,
    text:
      result.status === 'ok'
        ? {
            title: result.article.title,
            byline: result.article.byline,
            contentHtml: result.article.contentHtml,
            textLength: result.article.textLength
          }
        : null
  }
}

export const pluginArticles = (news: {
  getArticle: (id: string) => Promise<LoadedArticle>
  fetchArticlePage: (id: string) => Promise<{ url: string; html: string } | null>
}): PluginArticles => ({
  get: async id => pluginArticle(await news.getArticle(id)),
  page: id => news.fetchArticlePage(id)
})

// Hodi's articles when there are none to give: tests, and the tools that load plugins without the news.
export const NO_ARTICLES: PluginArticles = { get: async () => null, page: async () => null }
