import express from 'express'
import { type AlertSettings, type FollowedAlerts, isPushEndpoint } from '../news/followed-alerts.ts'
import { profileIdOf } from './profile-routes.ts'
import { TIME_PATTERN, isString, isTimeZone, wordList } from './validate.ts'

// A device's notification settings, or null when anything is off. Endpoints must be a known push service.
export const parseAlertSettings = (body: unknown): AlertSettings | null => {
  if (typeof body !== 'object' || body === null) return null
  const value = body as Record<string, unknown>
  const target = value.target as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined
  const words = wordList(value.words)
  const mutedWords = wordList(value.mutedWords)
  const hiddenSources =
    Array.isArray(value.hiddenSources) && value.hiddenSources.length <= 300
      ? value.hiddenSources.filter((id): id is string => isString(id, 100))
      : null

  if (
    !isString(target?.endpoint, 1000) ||
    !isPushEndpoint(target.endpoint) ||
    !isString(target.keys?.p256dh, 200) ||
    !isString(target.keys?.auth, 100) ||
    !words ||
    !mutedWords ||
    !hiddenSources ||
    typeof value.quietStart !== 'string' ||
    !TIME_PATTERN.test(value.quietStart) ||
    typeof value.quietEnd !== 'string' ||
    !TIME_PATTERN.test(value.quietEnd) ||
    !isTimeZone(value.timeZone) ||
    typeof value.badge !== 'boolean' ||
    !(value.shares === undefined || typeof value.shares === 'boolean') ||
    !(value.reactions === undefined || typeof value.reactions === 'boolean') ||
    !(value.plugins === undefined || typeof value.plugins === 'boolean')
  ) {
    return null
  }

  return {
    target: { endpoint: target.endpoint, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } },
    words,
    mutedWords,
    hiddenSources,
    quietStart: value.quietStart,
    quietEnd: value.quietEnd,
    timeZone: value.timeZone,
    badge: value.badge,
    shares: value.shares !== false,
    reactions: value.reactions !== false,
    plugins: value.plugins !== false
  }
}

export const pushRoutes = ({ alerts, publicKey }: { alerts?: FollowedAlerts; publicKey: string }) => {
  const router = express.Router()

  // Notifications: the app sends its subscription and what it follows each time it opens; the server keeps it.
  router.get('/push/key', (_request, response) => {
    if (!alerts) {
      response.status(503).json({ error: 'unavailable' })
      return
    }
    response.json({ publicKey: publicKey })
  })

  router.put('/push/subscription', (request, response) => {
    const settings = parseAlertSettings(request.body)
    if (!alerts) {
      response.status(503).json({ error: 'unavailable' })
      return
    }
    if (!settings) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    alerts.register({ ...settings, profileId: profileIdOf(response) })
    response.status(204).end()
  })

  router.delete('/push/subscription', (request, response) => {
    const endpoint: unknown = request.body?.endpoint
    if (typeof endpoint !== 'string') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    alerts?.unregister(endpoint)
    response.status(204).end()
  })

  router.post('/push/seen', (request, response) => {
    const endpoint: unknown = request.body?.endpoint
    if (typeof endpoint !== 'string') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    alerts?.markSeen(endpoint)
    response.status(204).end()
  })

  return router
}
