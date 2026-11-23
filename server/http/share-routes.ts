import express from 'express'
import { rateLimit } from 'express-rate-limit'
import type { GameStore } from '../db/game-store.ts'
import { isYoung } from '../db/profile-store.ts'
import { SHARES_RETENTION_MS } from '../db/user-store.ts'
import { textsIn } from '../i18n.ts'
import type { FollowedAlerts } from '../news/followed-alerts.ts'
import type { NewsService } from '../news/news-service.ts'
import { profileIdOf } from './profile-routes.ts'
import { type SharePeople, type SharePeopleOptions, sharePeople } from './share-people.ts'
import { CONFIG } from '../fixed-config.ts'

// How many @usernames a profile may look up in a minute: enough to type a few, too few to list the server's people.
const LOOKUPS_PER_MINUTE = CONFIG.shares.lookupsPerMinute

// The word sent with a share.
const MAX_SHARE_NOTE_LENGTH = CONFIG.shares.noteMaxLength
// What the reader of a shared article can send back.
const REACTIONS = ['👍', '❤️', '😂', '😮']

interface ShareRoutesOptions extends SharePeopleOptions {
  news: NewsService
  game?: GameStore
  alerts?: FollowedAlerts
  now: () => number
}

// "Partages": articles sent between people, and the emoji sent back.
export const shareRoutes = (options: ShareRoutesOptions) => {
  const router = express.Router()
  const people = sharePeople(options)
  mountPeopleRoutes(router, options, people)
  mountShareRoutes(router, options, people)
  mountReactionRoutes(router, options, people)
  return router
}

const mountPeopleRoutes = (router: express.Router, { users, profiles }: ShareRoutesOptions, people: SharePeople) => {
  const meOf = (response: express.Response) => profiles?.get(profileIdOf(response)) ?? null

  // "Envoyer à…": the people offered at once, and whether others can be found by their @username (an adult's own).
  router.get('/me/share-targets', (request, response) => {
    const me = meOf(response)
    const offered = me ? people.offered(me, request) : []
    const byHandle = me !== null && !isYoung(me) && people.sharingOn(me.id) && people.personOf(me).handle !== null
    response.json({ people: offered.map(people.personOf), byHandle })
  })

  // An @username typed in "Envoyer à…": the same null for nobody, sharing off and a young one outside the family.
  const limit = rateLimit({
    windowMs: 60_000,
    limit: LOOKUPS_PER_MINUTE,
    keyGenerator: (_request, response) => String(profileIdOf(response)),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({ error: 'too_many_requests' })
    }
  })
  router.get('/me/share-targets/:handle', limit, (request, response) => {
    const me = meOf(response)
    const to = me && !isYoung(me) ? people.byHandle(me, String(request.params.handle)) : null
    response.json({ person: to ? people.personOf(to) : null })
  })

  // Réglages › Partages: the people whose shares this profile can turn off, those it turned off included.
  router.get('/me/share-senders', (request, response) => {
    const me = meOf(response)
    if (!me) {
      response.json({ people: [] })
      return
    }
    const known = new Set([...people.mutedBy(me.id), ...users(me.id).sharedWith()])
    const offered = new Set(people.offered(me, request).map(profile => profile.id))
    const senders = (profiles?.list() ?? []).filter(
      profile => profile.id !== me.id && (offered.has(profile.id) || known.has(profile.id))
    )
    response.json({ people: senders.map(people.personOf) })
  })
}

const mountShareRoutes = (
  router: express.Router,
  { users, profiles, news, game, alerts, now }: ShareRoutesOptions,
  { sharingOn, mutedBy, mayShare }: SharePeople
) => {
  router.get('/me/shares', (_request, response) => {
    const profileId = profileIdOf(response)
    if (!sharingOn(profileId)) {
      response.json({ items: [] })
      return
    }
    const senders = new Set(
      (profiles?.list() ?? []).filter(other => other.id !== profileId && sharingOn(other.id)).map(other => other.id)
    )
    const muted = mutedBy(profileId)
    response.json({
      items: users(profileId)
        .shares(now() - SHARES_RETENTION_MS)
        .filter(share => senders.has(share.from) && !muted.includes(share.from))
    })
  })

  router.post('/me/shares', (request, response) => {
    const profileId = profileIdOf(response)
    const { articleId, to, note } = (request.body ?? {}) as { articleId?: unknown; to?: unknown; note?: unknown }
    const me = profiles?.get(profileId) ?? null
    const reachable = (id: unknown) => {
      const to = typeof id === 'number' ? profiles?.get(id) : null
      return me !== null && !!to && mayShare(me, to)
    }
    if (
      typeof articleId !== 'string' ||
      (note !== undefined && note !== null && (typeof note !== 'string' || note.length > MAX_SHARE_NOTE_LENGTH)) ||
      !Array.isArray(to) ||
      to.length === 0 ||
      !to.every(reachable)
    ) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const [item] = news.history([articleId])
    if (!item) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    const sender = users(profileId)
    const word = typeof note === 'string' && note.trim() !== '' ? note.trim() : null
    ;(to as number[]).forEach(id => sender.shareTo(id, item, now(), word))
    if (word) game?.recordShare(profileId, articleId, now())
    response.json({ ok: true })

    // The other profiles' devices hear of it, each in its profile's language; the share itself is already kept.
    const from = profiles?.list().find(profile => profile.id === profileId)?.name
    for (const id of to as number[]) {
      const video = item.kind === 'video' || item.kind === 'podcast'
      const t = textsIn(news.languageOf(id))
      void alerts?.notifyShare(id, {
        title: t(`push.shared.${item.kind}`, { name: from ?? t('push.someone') }),
        body: word ? t('push.note', { note: word, title: item.title }) : item.title,
        url: video ? `#/videos/${encodeURIComponent(articleId)}` : `#/article/${encodeURIComponent(articleId)}`,
        tag: `share:${articleId}`,
        badge: null
      })
    }
  })
}

const mountReactionRoutes = (
  router: express.Router,
  { users, profiles, news, game, alerts, now }: ShareRoutesOptions,
  { sharingOn }: SharePeople
) => {
  // An emoji back to whoever sent the article ("Léa a réagi ❤️"), changed or taken back at will.
  router.post('/me/shares/reaction', (request, response) => {
    const profileId = profileIdOf(response)
    const { articleId, from, reaction } = (request.body ?? {}) as {
      articleId?: unknown
      from?: unknown
      reaction?: unknown
    }
    if (
      typeof articleId !== 'string' ||
      typeof from !== 'number' ||
      !(reaction === null || (typeof reaction === 'string' && REACTIONS.includes(reaction)))
    ) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    const result = users(profileId).react(articleId, from, reaction, now())
    if (!result) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (result.changed && reaction !== null) game?.recordReaction(from, articleId, profileId, now())
    response.json({ ok: true })

    // Its sender hears of a new one, unless it turned sharing off since.
    if (!result.changed || reaction === null || !sharingOn(from)) return
    const { item } = result
    const name = profiles?.list().find(profile => profile.id === profileId)?.name
    const video = item.kind === 'video' || item.kind === 'podcast'
    const t = textsIn(news.languageOf(from))
    void alerts?.notifyShare(
      from,
      {
        title: t('push.reacted', { name: name ?? t('push.someone'), reaction }),
        body: typeof item.title === 'string' ? item.title : '',
        url: video ? `#/videos/${encodeURIComponent(articleId)}` : `#/article/${encodeURIComponent(articleId)}`,
        tag: `reaction:${articleId}:${profileId}`,
        badge: null
      },
      'reactions'
    )
  })

  // The reactions to what this profile sent, until "Partages" shows them.
  router.get('/me/shares/reactions', (_request, response) => {
    const profileId = profileIdOf(response)
    const known = new Set((profiles?.list() ?? []).map(profile => profile.id))
    response.json({
      items: sharingOn(profileId)
        ? users(profileId)
            .reactions()
            .filter(entry => known.has(entry.to))
        : []
    })
  })

  router.post('/me/shares/reactions/seen', (request, response) => {
    const { until } = (request.body ?? {}) as { until?: unknown }
    if (typeof until !== 'number' || !Number.isFinite(until)) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    users(profileIdOf(response)).markReactionsSeen(until)
    response.json({ ok: true })
  })
}
