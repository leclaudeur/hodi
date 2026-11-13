import { type RefObject, useEffect, useMemo, useState } from 'react'
import { type ArticleResult, type FeedItem, UnauthorizedError, getArticle } from '../../api.ts'
import { finishArticle } from '../../lib/article-embeds.ts'
import { closeArticle, markRead } from '../../lib/read-state.ts'
import { loadSanitizer } from '../../lib/deferred.ts'
import { findSaved, save } from '../../lib/saved.ts'
import { useReadingProgress } from './reading-progress.ts'

// About 230 words a minute.
const WORDS_A_MINUTE = 230
const wordsOf = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html').body.textContent?.match(/\S+/g)?.length ?? 0

// The article from the server, or from this browser's saved copy when the server cannot give it; its text sanitized.
export const useArticle = (articleId: string, onUnauthorized: () => void) => {
  const [result, setResult] = useState<ArticleResult | null>(null)
  const [error, setError] = useState(false)
  // "Réessayer" asks the server again.
  const [attempt, setAttempt] = useState(0)
  const retry = () => {
    setError(false)
    setResult(null)
    setAttempt(count => count + 1)
  }
  // Set with the first result: see the article's effect.
  const [sanitize, setSanitize] = useState<((html: string, articleId?: string) => string) | null>(null)

  useEffect(() => {
    let cancelled = false

    markRead(articleId)
    window.scrollTo({ top: 0 })

    // A saved article keeps its text in this browser: it still opens once out of the feeds or offline.
    const saved = findSaved(articleId)
    const savedResult: ArticleResult | null = saved?.article
      ? { status: 'ok', item: saved.item, article: saved.article }
      : null

    // The sanitizer (DOMPurify) comes in its own file, alongside the article: the text shows once both are here.
    const sanitizer = loadSanitizer()
    const show = (next: ArticleResult) =>
      sanitizer.then(
        ({ sanitizeArticle }) => {
          if (cancelled) return
          // One render: the text and its sanitizer arrive together.
          setSanitize(() => sanitizeArticle)
          setResult(next)
        },
        () => !cancelled && setError(true)
      )

    getArticle(articleId)
      .then(next => {
        if (cancelled) return
        if (next.status === 'ok' && saved && !saved.article) save(saved.item, next.article)
        return show(next.status === 'ok' ? next : (savedResult ?? next))
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        if (loadError instanceof UnauthorizedError) onUnauthorized()
        else if (savedResult) void show(savedResult)
        else setError(true)
      })

    return () => {
      cancelled = true
    }
  }, [articleId, attempt, onUnauthorized])

  // Back to the list, or on to another article: under "Masquer les articles lus", this one goes.
  useEffect(() => () => closeArticle(articleId), [articleId])

  const contentHtml = useMemo(
    () => (result?.status === 'ok' && sanitize ? sanitize(result.article.contentHtml, result.item.id) : ''),
    [result, sanitize]
  )
  const words = useMemo(() => wordsOf(contentHtml), [contentHtml])
  const readingMinutes = words > 0 ? Math.max(1, Math.round(words / WORDS_A_MINUTE)) : null
  return { result, error, retry, contentHtml, readingMinutes, exactMinutes: words / WORDS_A_MINUTE }
}

// A picture that cannot load (offline: only the text is kept) leaves no broken frame, nor its caption.
const useArticleImages = (content: RefObject<HTMLDivElement | null>, contentHtml: string) =>
  useEffect(() => {
    const element = content.current
    if (!element) return
    const hideImage = (image: HTMLElement) => {
      const frame = image.closest('figure') ?? image
      frame.style.display = 'none'
    }
    // The server's smaller copies failed: the site's own picture, then nothing.
    const fallBack = (image: HTMLImageElement) => {
      if (!image.srcset) return hideImage(image)
      image.removeAttribute('srcset')
      image.removeAttribute('sizes')
    }
    const hide = (event: Event) => fallBack(event.target as HTMLImageElement)
    // A figure takes its picture's width: until the picture arrives it has none, and the caption would be squeezed
    // into a narrow column. The figure keeps the column's width while its picture loads.
    const loaded = (event: Event) => delete (event.target as HTMLElement).closest('figure')?.dataset.loading
    const images = [...element.querySelectorAll('img')]
    images.forEach(image => {
      image.addEventListener('error', hide)
      if (image.complete && image.naturalWidth === 0 && image.currentSrc) fallBack(image)
      const figure = image.closest('figure')
      if (figure && !image.complete) {
        figure.dataset.loading = ''
        image.addEventListener('load', loaded)
        image.addEventListener('error', loaded)
      }
    })
    return () =>
      images.forEach(image => {
        image.removeEventListener('error', hide)
        image.removeEventListener('load', loaded)
        image.removeEventListener('error', loaded)
      })
  }, [content, contentHtml])

interface TextInput {
  contentHtml: string
  readingMinutes: number | null
  exactMinutes: number
}

// Once the text shows: its embeds finished, its broken pictures hidden, and its reading counted in the stats.
export const useArticleText = (
  content: RefObject<HTMLDivElement | null>,
  shown: FeedItem | null,
  { contentHtml, readingMinutes, exactMinutes }: TextInput
) => {
  // Logos on embedded posts and videos, and the layout of groups of pictures once their size is known.
  useEffect(() => (content.current ? finishArticle(content.current) : undefined), [content, contentHtml])

  // Counted in the reading stats once the text is shown, read for good or only skimmed.
  useReadingProgress(
    content,
    shown
      ? {
          id: shown.id,
          sourceId: shown.sourceId,
          sourceName: shown.sourceName,
          estimate: readingMinutes ?? 0,
          exact: exactMinutes
        }
      : null
  )
  useArticleImages(content, contentHtml)
}

// Once the title has scrolled away, the desktop bar shows it and the phone's buttons get a band under them: watched,
// not computed on every scroll.
export const useTitleScrolled = (title: RefObject<HTMLHeadingElement | null>, hasItem: boolean, layout: string) => {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const element = title.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setScrolled(entry ? !entry.isIntersecting : false), {
      rootMargin: `${layout === 'desktop' ? -64 : -88}px 0px 0px 0px`
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [title, hasItem, layout])
  return scrolled
}
