import express from 'express'
import type { GameStore } from '../db/game-store.ts'
import type { ProfileStore } from '../db/profile-store.ts'
import { SHARES_RETENTION_MS, type UserStore } from '../db/user-store.ts'
import { textsIn } from '../i18n.ts'
import type { FollowedAlerts } from '../news/followed-alerts.ts'
import type { NewsService } from '../news/news-service.ts'
import { profileIdOf } from './profile-routes.ts'

// The word sent with a share.
const MAX_SHARE_NOTE_LENGTH = 140
// What the reader of a shared article can send back.
const REACTIONS = ['👍', '❤️', '😂', '😮']

interface ShareRoutesOptions {
  users: (profileId: number) => UserStore
  profiles?: ProfileStore
  news: NewsService
  game?: GameStore
  alerts?: FollowedAlerts
  now: () => number
}

// "Partages": articles sent between the household's profiles, and the emoji sent back.
export const shareRoutes = (options: ShareRoutesOptions) => {
  const router = express.Router()
  const rules = sharingRules(options)
  mountShareRoutes(router, options, rules)
  mountReactionRoutes(router, options, rules)
  return router
}

const sharingRules = ({ users, profiles }: ShareRoutesOptions) => {
  // A profile with sharing off neither sends nor receives; one can also turn off what a given profile sends.
  const sharingOn = (profileId: number) => users(profileId).preferences()?.sharing !== false
  const mutedBy = (profileId: number) => {
    const muted = users(profileId).preferences()?.mutedSharers
    return Array.isArray(muted) ? (muted as number[]) : []
  }
  // Who this profile can send to: the others with sharing on that did not turn it off.
  const shareTargets = (profileId: number) =>
    sharingOn(profileId)
      ? (profiles?.list() ?? [])
          .filter(other => other.id !== profileId && sharingOn(other.id) && !mutedBy(other.id).includes(profileId))
          .map(other => other.id)
      : []
  return { sharingOn, mutedBy, shareTargets }
}

type SharingRules = ReturnType<typeof sharingRules>

const mountShareRoutes = (
  router: express.Router,
  { users, profiles, news, game, alerts, now }: ShareRoutesOptions,
  { sharingOn, mutedBy, shareTargets }: SharingRules
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

  router.get('/me/share-targets', (_request, response) => {
    response.json({ profiles: shareTargets(profileIdOf(response)) })
  })

  router.post('/me/shares', (request, response) => {
    const profileId = profileIdOf(response)
    const { articleId, to, note } = (request.body ?? {}) as { articleId?: unknown; to?: unknown; note?: unknown }
    const targets = shareTargets(profileId)
    if (
      typeof articleId !== 'string' ||
      (note !== undefined && note !== null && (typeof note !== 'string' || note.length > MAX_SHARE_NOTE_LENGTH)) ||
      !Array.isArray(to) ||
      to.length === 0 ||
      !to.every(id => typeof id === 'number' && targets.includes(id))
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
  { sharingOn }: SharingRules
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
