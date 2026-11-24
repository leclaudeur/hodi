import type { AlertPayload } from '../news/followed-alerts.ts'
import { DAY_MS, HOUR_MS } from '../../shared/time.ts'
import { CONFIG } from '../fixed-config.ts'

// ctx.notify: a plugin tells a person something on their devices (« Ta demande est acceptée »), through the same push
// as shares, in each device's quiet hours and with its « Plugins » switch. The core builds the notification from
// short plain text and an address inside the plugin's own page, and counts each plugin's notices to a profile here,
// in the main thread, where a restart of the plugin's thread cannot reset them.

// How many notices one plugin may send to one profile in a day.
export const PLUGIN_NOTICES_PER_DAY = CONFIG.pluginNotices.perDay
// And in an hour: a loop or a bug spends a few, not the whole day at once.
export const PLUGIN_NOTICES_PER_HOUR = CONFIG.pluginNotices.perHour

const MAX_TITLE = CONFIG.pluginNotices.titleMaxLength
const MAX_TEXT = CONFIG.pluginNotices.textMaxLength
// A path under the plugin's page: letters, digits and a few signs, never "..".
const PATH = /^(?!.*\.\.)[A-Za-z0-9._~/-]{1,200}$/
// One line for the title, a few for the text; no other control character.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const TEXT_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/

export interface PluginNotice {
  // One of the two: a profile, or every profile of an account.
  profileId: number | null
  accountId: number | null
  title: string
  text: string
  path: string | null
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

// What a plugin may give, or null when something is missing, too long or not plain text.
export const pluginNotice = (value: unknown): PluginNotice | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { profileId, accountId, title, text, path, ...rest } = value as Record<string, unknown>
  if (Object.keys(rest).length > 0) return null
  if ((profileId === undefined) === (accountId === undefined)) return null
  if (profileId !== undefined && !isId(profileId)) return null
  if (accountId !== undefined && !isId(accountId)) return null
  if (typeof title !== 'string' || title.trim() === '' || title.length > MAX_TITLE || CONTROL.test(title)) return null
  if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_TEXT || TEXT_CONTROL.test(text)) return null
  if (path !== undefined && (typeof path !== 'string' || !PATH.test(path))) return null
  return {
    profileId: profileId ?? null,
    accountId: accountId ?? null,
    title: title.trim(),
    text: text.trim(),
    path: path ?? null
  }
}

export interface PluginNotifier {
  // reader: the profile whose request the plugin's call answers; null outside one (a task, onArticle).
  send: (plugin: { id: string; name: string }, value: unknown, reader: number | null) => Promise<void>
}

// No push at all (tests that do not need it): every notice is refused.
export const NO_NOTICES: PluginNotifier = {
  send: async () => {
    throw new Error('notify_unavailable')
  }
}

export const pluginNotifier = ({
  hasProfile,
  profileOf,
  knows,
  push,
  now = Date.now,
  log = console.log
}: {
  // Whether the profile is still there.
  hasProfile: (profileId: number) => boolean
  // The profile an account reads with; null without one.
  profileOf: (accountId: number) => number | null
  // Whether a reader has a tie with another profile: family, or a share either way.
  knows: (reader: number, profileId: number) => boolean
  // The profile's devices that want it, outside their quiet hours.
  push: (profileId: number, payload: AlertPayload) => Promise<void>
  now?: () => number
  log?: (line: string) => void
}): PluginNotifier => {
  // The times of each plugin's notices to each profile in the last day.
  const sent = new Map<string, number[]>()

  // Within a reader's call, only the reader and the people they have a tie with: a plugin's route never becomes a
  // way to reach anyone on the server. Outside one, anyone.
  const targetOf = (notice: PluginNotice, reader: number | null) => {
    const target = notice.profileId ?? profileOf(notice.accountId!)
    if (target === null || !hasProfile(target)) return null
    return reader === null || target === reader || knows(reader, target) ? target : null
  }

  // A day's and an hour's notices per plugin and profile, counted whatever the plugin does.
  const counted = (pluginId: string, profileId: number, at: number) => {
    const key = `${pluginId}|${profileId}`
    const times = (sent.get(key) ?? []).filter(time => at - time < DAY_MS)
    const lastHour = times.filter(time => at - time < HOUR_MS)
    if (times.length >= PLUGIN_NOTICES_PER_DAY || lastHour.length >= PLUGIN_NOTICES_PER_HOUR) {
      sent.set(key, times)
      log(`[plugin ${pluginId}] notify: too many notices for profile ${profileId}`)
      return false
    }
    sent.set(key, [...times, at])
    return true
  }

  return {
    send: async (plugin, value, reader) => {
      const notice = pluginNotice(value)
      if (!notice) throw new Error('invalid_notice')
      const target = targetOf(notice, reader)
      if (target === null) {
        // A named profile that is not there, or not the reader's to reach; an account with no profile yet is no one.
        if (notice.profileId !== null) throw new Error('unknown_profile')
        return
      }
      if (!counted(plugin.id, target, now())) throw new Error('too_many_notices')
      await push(target, {
        title: `${plugin.name} · ${notice.title}`,
        body: notice.text,
        url: `#/settings/plugin/${plugin.id}${notice.path ? `/${notice.path}` : ''}`,
        // A newer notice of the plugin replaces the one before on the device.
        tag: `plugin:${plugin.id}`,
        badge: null
      })
    }
  }
}
