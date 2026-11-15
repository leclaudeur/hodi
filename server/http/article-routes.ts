import express from 'express'
import type { UserStore } from '../db/user-store.ts'
import { type ImageSize, inlineImageSources, numberInlineImages } from '../news/inline-images.ts'
import type { NewsService } from '../news/news-service.ts'
import { profileIdOf } from './profile-routes.ts'
import type { ReaderContext } from './reader-context.ts'

const MAX_QUESTION_LENGTH = 300

// HTTP status of each way an AI request can fail.
const AI_ERROR_STATUS = {
  unavailable: 503,
  unknown: 404,
  unreadable: 422,
  failed: 502,
  refused: 422,
  limited: 429
} as const

const ITEM_ID_PATTERN = /^[\w-]{16}$/

export interface ArticleImages {
  file: (articleId: string, width: number) => Promise<string | null>
  // Picture n inside an article's text.
  inlineFile: (articleId: string, index: number, width: number) => Promise<string | null>
  // Its size, once made.
  inlineSize: (articleId: string, index: number) => Promise<ImageSize | null>
}

interface ArticleRoutesOptions {
  news: NewsService
  users?: (profileId: number) => UserStore
  images?: ArticleImages
  reader: ReaderContext
}

// The reader: an article by its id, its pictures, and the AI's summary and answers.
export const articleRoutes = (options: ArticleRoutesOptions) => {
  const router = express.Router()
  mountImageRoutes(router, options)
  mountArticleRoute(router, options)
  mountAiRoutes(router, options)
  return router
}

const mountImageRoutes = (
  router: express.Router,
  { news, users, images, reader: { youthFilterOf } }: ArticleRoutesOptions
) => {
  // A young profile sees the pictures of the articles it may open: its sources', and those sent to it or saved.
  const hiddenFromYoung = (response: express.Response, id: string) => {
    const young = youthFilterOf(response)
    if (!young) return false
    const [item] = news.history([id])
    const user = users?.(profileIdOf(response))
    return !(item && young.shown(item)) && !user?.wasSharedWith(id) && !user?.isSaved(id)
  }

  // An article's picture at one of the widths of IMAGE_WIDTHS, by the article's id: never a URL from the client.
  const sendPicture = (response: express.Response, file: string | null) => {
    if (!file) {
      // The card or the reader falls back to the site's own picture.
      response.set('Cache-Control', 'private, max-age=3600').status(404).json({ error: 'not_found' })
      return
    }
    // The same id and width always give the same picture.
    response.set('Cache-Control', 'private, max-age=604800, immutable')
    response.sendFile(file)
  }

  router.get('/images/:id/:width', async (request, response) => {
    const { id, width } = request.params
    sendPicture(
      response,
      images && ITEM_ID_PATTERN.test(id) && !hiddenFromYoung(response, id) ? await images.file(id, Number(width)) : null
    )
  })

  router.get('/images/:id/:index/:width', async (request, response) => {
    const { id, index, width } = request.params
    sendPicture(
      response,
      images && ITEM_ID_PATTERN.test(id) && /^\d{1,3}$/.test(index) && !hiddenFromYoung(response, id)
        ? await images.inlineFile(id, Number(index), Number(width))
        : null
    )
  })
}

const mountArticleRoute = (
  router: express.Router,
  { news, users, images, reader: { youthFilterOf } }: ArticleRoutesOptions
) => {
  router.get('/articles/:id', async (request, response) => {
    if (!ITEM_ID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    const result = await news.getArticle(request.params.id)

    // A young profile opens the articles of its sources, and those a parent sent it or it saved.
    const young = youthFilterOf(response)
    const user = users?.(profileIdOf(response))
    if (
      young &&
      result.status !== 'unknown' &&
      !young.shown(result.item) &&
      !user?.wasSharedWith(request.params.id) &&
      !user?.isSaved(request.params.id)
    ) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    if (result.status === 'unknown') {
      // Saved on a device before the server kept articles: the text came with it.
      const saved = users?.(profileIdOf(response)).savedArticle(request.params.id)
      if (saved) {
        response.json({ status: 'ok', item: saved.item, article: saved.article, canSummarize: false })
        return
      }
      // The item never was in a configured feed.
      response.status(404).json({ error: 'not_found' })
      return
    }

    if (result.status === 'ok') {
      const { title, byline, contentHtml } = result.article
      // Its pictures numbered, for the reader to ask for their smaller copies, with the size of those already made.
      const sizes =
        images &&
        (await Promise.all(inlineImageSources(contentHtml).map((_, index) => images.inlineSize(result.item.id, index))))
      response.json({
        status: 'ok',
        item: result.item,
        article: { title, byline, contentHtml: sizes ? numberInlineImages(contentHtml, sizes) : contentHtml },
        canSummarize: news.canSummarize
      })
      return
    }

    response.status(result.status === 'failed' ? 502 : 200).json({ status: result.status, item: result.item })
  })
}

// Each answers a click on a purple button.
const mountAiRoutes = (router: express.Router, { news, reader: { adultsOnly } }: ArticleRoutesOptions) => {
  router.post('/articles/:id/summary', async (request, response) => {
    if (!adultsOnly(response)) return
    if (!ITEM_ID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    const result = await news.getSummary(request.params.id, profileIdOf(response))

    if (result.status === 'ok') {
      response.json(result)
      return
    }

    response.status(AI_ERROR_STATUS[result.status]).json({ error: result.status })
  })

  router.post('/articles/:id/question', async (request, response) => {
    if (!adultsOnly(response)) return
    const question: unknown = request.body?.question

    if (!ITEM_ID_PATTERN.test(request.params.id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    if (typeof question !== 'string' || question.trim() === '' || question.length > MAX_QUESTION_LENGTH) {
      response.status(400).json({ error: 'bad_request' })
      return
    }

    const result = await news.answerQuestion(request.params.id, question.trim(), profileIdOf(response))

    if (result.status === 'ok') {
      response.json(result)
      return
    }

    response.status(AI_ERROR_STATUS[result.status]).json({ error: result.status })
  })
}
