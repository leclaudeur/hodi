import type { ServerNotifier } from '../notices/server-notifier.ts'
import { DAY_MS } from '../../shared/time.ts'
import type { ServerNoticeSpec } from './manifest-notices.ts'
import { type Written, writtenIn, writtenOf } from './written.ts'

// ctx.notifyServerAdmin: a plugin tells the server's admin of an event of one of its kinds (manifest
// serverNotifications), which reaches them as they chose in Serveur › Notifications. The core builds the e-mail and
// the push from short plain text and counts each plugin's notices here, in the main thread.

// How many notices one plugin may send the server's admin in a day.
export const SERVER_NOTICES_PER_DAY = 50

const MAX_TITLE = 80
const MAX_TEXT = 240
// A path under the plugin's sections of /server: letters, digits and a few signs, never "..".
const PATH = /^(?!.*\.\.)[A-Za-z0-9._~/-]{1,200}$/
// A plugin's own key for a notice that waits (« waitlist:12 »).
const KEY = /^[A-Za-z0-9._:-]{1,100}$/
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const TEXT_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/

export interface PluginServerNotice {
  title: Written
  text: Written
  path: string | null
  important: string | null
}

const fitsTitle = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= MAX_TITLE && !CONTROL.test(value)
const fitsText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= MAX_TEXT && !TEXT_CONTROL.test(value)

// What a plugin may give, or null when something is missing, too long or not plain text. Its title and text are one
// text, or one per language.
export const pluginServerNotice = (value: unknown): PluginServerNotice | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { title, text, path, important, ...rest } = value as Record<string, unknown>
  if (Object.keys(rest).length > 0) return null
  const written = { title: writtenOf(title, fitsTitle), text: writtenOf(text, fitsText) }
  if (!written.title || !written.text) return null
  if (path !== undefined && (typeof path !== 'string' || !PATH.test(path))) return null
  if (important !== undefined && !isKey(important)) return null
  return { title: written.title, text: written.text, path: path ?? null, important: important ?? null }
}

const isKey = (value: unknown): value is string => typeof value === 'string' && KEY.test(value)

// Its key among the server's: one plugin never closes another's, nor the core's.
const importantKey = (pluginId: string, key: string) => `plugin:${pluginId}:${key}`

// The id a plugin's kind has in Serveur › Notifications.
export const pluginNoticeType = (pluginId: string, type: string) => `plugin:${pluginId}:${type}`

export interface PluginServerNotifier {
  send: (
    plugin: { id: string; name: string; kinds: ServerNoticeSpec[] },
    type: unknown,
    value: unknown
  ) => Promise<void>
  handled: (plugin: { id: string }, key: unknown) => void
}

export const pluginServerNotifier = ({
  notifier,
  now = Date.now,
  log = console.log
}: {
  notifier: ServerNotifier
  now?: () => number
  log?: (line: string) => void
}): PluginServerNotifier => {
  // The times of each plugin's notices of the last day.
  const sent = new Map<string, number[]>()

  return {
    send: async (plugin, type, value) => {
      if (typeof type !== 'string' || !plugin.kinds.some(kind => kind.type === type)) throw new Error('unknown_type')
      const notice = pluginServerNotice(value)
      if (!notice) throw new Error('invalid_notice')
      const at = now()
      const times = (sent.get(plugin.id) ?? []).filter(time => at - time < DAY_MS)
      if (times.length >= SERVER_NOTICES_PER_DAY) {
        sent.set(plugin.id, times)
        log(`[plugin ${plugin.id}] notifyServerAdmin: ${SERVER_NOTICES_PER_DAY} a day reached`)
        throw new Error('too_many_notices')
      }
      sent.set(plugin.id, [...times, at])
      await notifier.tell(
        pluginNoticeType(plugin.id, type),
        language => ({
          from: plugin.name,
          title: writtenIn(notice.title, language),
          text: writtenIn(notice.text, language),
          // Its section of /server and a screen under it; without one, the page where the admin chose.
          url: notice.path ? `#/server/plugin/${plugin.id}/${notice.path}` : '#/server/notifications'
        }),
        notice.important ? { important: importantKey(plugin.id, notice.important) } : {}
      )
    },
    handled: (plugin, key) => {
      if (!isKey(key)) throw new Error('invalid_key')
      notifier.handled?.(importantKey(plugin.id, key))
    }
  }
}

// Without a server notifier (tests that do not need it): every notice is refused.
export const NO_PLUGIN_SERVER_NOTICES: PluginServerNotifier = {
  send: async () => {
    throw new Error('notify_unavailable')
  },
  handled: () => {
    throw new Error('notify_unavailable')
  }
}
