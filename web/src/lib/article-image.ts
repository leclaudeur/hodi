import { useState } from 'react'

// An article's picture as the server made it smaller (server/news/article-images.ts), by the article's id: the
// browser picks the width it needs from srcset, and a phone never downloads a site's 1600-pixel original for a card.
const WIDTHS = [240, 480, 960]

export const articleImageUrl = (articleId: string, width: number) =>
  `/api/images/${encodeURIComponent(articleId)}/${width}`

export const articleImageSrcSet = (articleId: string) =>
  WIDTHS.map(width => `${articleImageUrl(articleId, width)} ${width}w`).join(', ')

// Picture n inside an article's text, numbered by the server (data-image).
export const inlineImageSrcSet = (articleId: string, index: number) =>
  WIDTHS.map(width => `/api/images/${encodeURIComponent(articleId)}/${index}/${width} ${width}w`).join(', ')

export interface ArticleImageProps {
  src: string
  srcSet?: string
  sizes?: string
  onError: () => void
}

// The props of an <img> showing an article's picture at the width it takes on screen (`sizes`). When the server has
// none (a site that refused it), the site's own picture; when that fails too, null: the place stays plain.
export const useArticleImage = (
  articleId: string,
  original: string | null | undefined,
  sizes: string
): ArticleImageProps | null => {
  const [step, setStep] = useState<{ articleId: string; fallback: 'original' | 'none' } | null>(null)
  // A new article (a story that goes on) starts again from the smaller copy.
  const fallback = step?.articleId === articleId ? step.fallback : null
  if (!original || fallback === 'none') return null
  if (fallback === 'original') return { src: original, onError: () => setStep({ articleId, fallback: 'none' }) }
  return {
    src: articleImageUrl(articleId, 480),
    srcSet: articleImageSrcSet(articleId),
    sizes,
    onError: () => setStep({ articleId, fallback: 'original' })
  }
}
