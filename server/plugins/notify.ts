import type { AlertPayload } from '../news/followed-alerts.ts'
import { DAY_MS } from '../../shared/time.ts'

// ctx.notify: a plugin tells a person something on their devices (« Ta demande est acceptée »), through the same push
// as shares, in each device's quiet hours and with its « Plugins » switch. The core builds the notification from
// short plain text and an address inside the plugin's own page, and counts each plugin's notices to a profile here,
// in the main thread, where a restart of the plugin's thread cannot reset them.

// How many notices one plugin may send to one profile in a day.
export const PLUGIN_NOTICES_PER_DAY = 10

const MAX_TITLE = 80
const MAX_TEXT = 240
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
  // householdId: the household the plugin's call is for; null for a task, a public or a server route.
  send: (plugin: { id: string; name: string }, value: unknown, householdId: number | null) => Promise<void>
}

// No push at all (tests that do not need it): every notice is refused.
export const NO_NOTICES: PluginNotifier = {
  send: async () => {
    throw new Error('notify_unavailable')
  }
}

export const pluginNotifier = ({
  householdOf,
  profilesOf,
  push,
  now = Date.now,
  log = console.log
}: {
  // The household of a profile; null when there is none.
  householdOf: (profileId: number) => number | null
  // The profiles of an account, in every household.
  profilesOf: (accountId: number) => { profileId: number; householdId: number }[]
  // The profile's devices that want it, outside their quiet hours.
  push: (profileId: number, payload: AlertPayload) => Promise<void>
  now?: () => number
  log?: (line: string) => void
}): PluginNotifier => {
  // The times of each plugin's notices to each profile in the last day.
  const sent = new Map<string, number[]>()

  return {
    send: async (plugin, value, householdId) => {
      const notice = pluginNotice(value)
      if (!notice) throw new Error('invalid_notice')
      // Within a household's call, only that household's people; anywhere else (a task), anyone.
      const inScope = (household: number | null) =>
        household !== null && (householdId === null || household === householdId)
      const targets =
        notice.profileId !== null
          ? inScope(householdOf(notice.profileId))
            ? [notice.profileId]
            : []
          : profilesOf(notice.accountId!)
              .filter(({ householdId: household }) => inScope(household))
              .map(({ profileId }) => profileId)
      if (notice.profileId !== null && targets.length === 0) throw new Error('unknown_profile')
      const at = now()
      const payload: AlertPayload = {
        title: `${plugin.name} · ${notice.title}`,
        body: notice.text,
        url: `#/settings/plugin/${plugin.id}${notice.path ? `/${notice.path}` : ''}`,
        // A newer notice of the plugin replaces the one before on the device.
        tag: `plugin:${plugin.id}`,
        badge: null
      }
      for (const profileId of targets) {
        const key = `${plugin.id}|${profileId}`
        const times = (sent.get(key) ?? []).filter(time => at - time < DAY_MS)
        if (times.length >= PLUGIN_NOTICES_PER_DAY) {
          sent.set(key, times)
          log(`[plugin ${plugin.id}] notify: ${PLUGIN_NOTICES_PER_DAY} a day reached for profile ${profileId}`)
          // Said to the plugin when it named the profile; for an account, its other profiles are still told.
          if (notice.profileId !== null) throw new Error('too_many_notices')
          continue
        }
        sent.set(key, [...times, at])
        await push(profileId, payload)
      }
    }
  }
}
