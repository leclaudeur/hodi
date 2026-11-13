import express from 'express'
import type { GameStore } from '../db/game-store.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import type { NewsService } from '../news/news-service.ts'
import { profileIdOf, requireAdmin } from './profile-routes.ts'

// What the server knows of an article or a video read, for the game: its kind, its theme, when it came out.
export const readFactsOf = (news: NewsService) => (id: string) => {
  const [item] = news.history([id])
  if (!item) return null
  const published = item.publishedAt === null ? NaN : Date.parse(item.publishedAt)
  return {
    kind: item.kind === 'article' ? ('article' as const) : ('video' as const),
    topicId: item.kind === 'article' ? item.topicId : null,
    publishedAt: Number.isFinite(published) ? published : null
  }
}

interface GameRoutesOptions {
  game: GameStore
  news: NewsService
  profiles?: ProfileStore
  now: () => number
}

// The themes the all-rounder badge asks for: those with sources.
const gameTopicsOf = (news: NewsService) => () =>
  news.catalog.topics.filter(topic => topic.sources.length > 0).map(topic => topic.id)

// The household game: this profile's points, level, week and badges; the badge on its avatar.
export const gameRoutes = (options: GameRoutesOptions) => {
  const router = express.Router()
  mountOwnGameRoutes(router, options)
  mountHouseholdGameRoutes(router, options)
  return router
}

// The profile asking: its sheet, its badge, what it has seen.
const mountOwnGameRoutes = (router: express.Router, { game, news, now }: GameRoutesOptions) => {
  const gameTopics = gameTopicsOf(news)

  router.get('/me/game', (_request, response) => {
    const profileId = profileIdOf(response)
    const language = news.languageOf(profileId)
    response.json({
      ...game.summary(profileId, now(), language),
      badges: game.badges(profileId, gameTopics(), language),
      badge: game.wornBadge(profileId, gameTopics()),
      news: game.news(profileId, gameTopics(), now())
    })
  })

  // The sheet showed what was new: celebrated, no longer new.
  router.post('/me/game/seen', (_request, response) => {
    game.markSeen(profileIdOf(response), gameTopics(), now())
    response.status(204).end()
  })

  router.put('/me/game/badge', (request, response) => {
    const { badge } = (request.body ?? {}) as { badge?: unknown }
    if (
      !(badge === null || typeof badge === 'string') ||
      !game.wear(profileIdOf(response), badge, gameTopics(), now())
    ) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    response.json({ badge })
  })

  // Opened from a notification of a followed subject.
  router.post('/me/game/alerts', (request, response) => {
    const { articleId } = (request.body ?? {}) as { articleId?: unknown }
    if (typeof articleId !== 'string' || articleId === '' || articleId.length > 200) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    // Only an article the server listed: a made-up id earns the badge nothing.
    if (news.history([articleId]).length > 0) game.recordAlert(profileIdOf(response), articleId, now())
    response.status(204).end()
  })
}

const mountHouseholdGameRoutes = (router: express.Router, { game, news, profiles, now }: GameRoutesOptions) => {
  const gameTopics = gameTopicsOf(news)

  // Statistiques > Foyer: the week's challenge and ranking, each profile with its level and badge.
  router.get('/game', (_request, response) => {
    const profileId = profileIdOf(response)
    const language = news.languageOf(profileId)
    const ranking = (profiles?.list() ?? []).map(profile => {
      const { week, level, name, progress } = game.summary(profile.id, now(), language)
      return { profileId: profile.id, week, level, name, progress, badge: game.wornBadge(profile.id, gameTopics()) }
    })
    response.json({
      enabled: game.enabled(),
      challenge: game.challenge(now()),
      ranking: ranking.sort((a, b) => b.week - a.week),
      // The profile asking: what its avatar has to show as new.
      news: game.news(profileId, gameTopics(), now())
    })
  })

  // Another profile's sheet: its level and the badges it earned.
  router.get('/game/profiles/:id', (request, response) => {
    const id = Number(request.params.id)
    if (!profiles?.list().some(profile => profile.id === id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    const language = news.languageOf(profileIdOf(response))
    response.json({
      ...game.summary(id, now(), language),
      badges: game.badges(id, gameTopics(), language).filter(badge => badge.tier > 0),
      badge: game.wornBadge(id, gameTopics())
    })
  })

  router.put('/game/enabled', requireAdmin, (request, response) => {
    const { enabled } = (request.body ?? {}) as { enabled?: unknown }
    if (typeof enabled !== 'boolean') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    game.setEnabled(enabled)
    response.json({ enabled })
  })
}
