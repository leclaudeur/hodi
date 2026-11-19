import express from 'express'
import { DEFAULT_CHOICE, type ServerNoticeStore } from '../db/server-notice-store.ts'
import { isPushEndpoint } from '../news/followed-alerts.ts'
import type { ServerNoticeSpec } from '../plugins/manifest-notices.ts'
import type { ManifestTranslations } from '../plugins/manifest-texts.ts'
import { pluginNoticeType } from '../plugins/server-notify.ts'
import { isString } from './validate.ts'

// Serveur › Notifications: the kinds of events the server tells its admin of, and how each reaches them, and the
// devices of their account that take the push ones.

// A plugin that tells of events: its name, its kinds and their texts in other languages.
export interface NoticePlugin {
  id: string
  name: string
  translations: ManifestTranslations
  kinds: ServerNoticeSpec[]
}

interface NoticeRoutesOptions {
  store: ServerNoticeStore
  // The server admin asking: their own choices and devices.
  accountOf: (response: express.Response) => number | null
  // The core's own kinds (« weekly-report »), named by the web app's texts.
  coreKinds: string[]
  plugins: () => NoticePlugin[]
  // false: Serveur › E-mail is not set, and the e-mail boxes wait for it.
  mailReady: () => boolean
  // The key a browser subscribes to push with; null when push is off on this server.
  publicKey: string | null
  now: () => number
}

// The kinds of the page, in its order: the core's, then each plugin's under its name.
const kindsOf = ({ coreKinds, plugins }: NoticeRoutesOptions) => [
  ...coreKinds.map(key => ({ id: `core:${key}`, key, plugin: null, label: null, hint: null, translations: {} })),
  ...plugins().flatMap(plugin =>
    plugin.kinds.map(kind => ({
      id: pluginNoticeType(plugin.id, kind.type),
      key: kind.type,
      plugin: { id: plugin.id, name: plugin.name, translations: plugin.translations },
      label: kind.label,
      hint: kind.hint,
      translations: Object.fromEntries(
        Object.entries(plugin.translations).flatMap(([language, texts]) => {
          const own = texts.serverNotifications?.[kind.type]
          return own ? [[language, own]] : []
        })
      )
    }))
  )
]

const targetOf = (value: unknown) => {
  const target = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined
  if (!isString(target?.endpoint, 1000) || !isPushEndpoint(target.endpoint)) return null
  if (!isString(target.keys?.p256dh, 200) || !isString(target.keys?.auth, 100)) return null
  return { endpoint: target.endpoint, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } }
}

export const serverNoticeRoutes = (options: NoticeRoutesOptions) => {
  const router = express.Router()
  const { store } = options
  // An install from before accounts has no admin to choose for.
  router.use((_request, response, next) => {
    const account = options.accountOf(response)
    if (account === null) {
      response.status(403).json({ error: 'account_only' })
      return
    }
    response.locals.noticeAccount = account
    next()
  })
  const accountOf = (response: express.Response) => response.locals.noticeAccount as number

  router.get('/', (_request, response) => {
    const choices = store.choices(accountOf(response))
    response.json({
      mail: options.mailReady(),
      publicKey: options.publicKey,
      kinds: kindsOf(options).map(kind => ({ ...kind, ...(choices.get(kind.id) ?? DEFAULT_CHOICE) }))
    })
  })

  router.put('/kinds/:id', (request, response) => {
    const { email, push } = (request.body ?? {}) as { email?: unknown; push?: unknown }
    const known = kindsOf(options).some(kind => kind.id === request.params.id)
    // A code asked for always reaches the admin some way: someone waits on it.
    const silenced = request.params.id === 'core:code-request' && email === false && push === false
    if (!known || typeof email !== 'boolean' || typeof push !== 'boolean' || silenced) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    store.choose(accountOf(response), request.params.id, { email, push })
    response.status(204).end()
  })

  // « Push sur cet appareil »: sent each time the page opens with the switch on, as a browser can renew it.
  router.put('/device', (request, response) => {
    const target = targetOf(request.body?.target)
    if (!target || !options.publicKey) {
      response.status(target ? 503 : 400).json({ error: target ? 'unavailable' : 'bad_request' })
      return
    }
    store.addDevice(accountOf(response), target, options.now())
    response.status(204).end()
  })

  router.delete('/device', (request, response) => {
    const endpoint: unknown = request.body?.endpoint
    if (typeof endpoint !== 'string') {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    store.removeDevice(endpoint, accountOf(response))
    response.status(204).end()
  })

  return router
}
