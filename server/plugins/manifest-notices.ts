import { CONFIG } from '../fixed-config.ts'

// A plugin's kinds of server notices (manifest.serverNotifications): the events its code may tell the server's admin
// of with ctx.notifyServerAdmin, each a row of Serveur › Notifications under the plugin's name, where the admin
// chooses e-mail, push, both or neither. Their texts in other languages are in its locales, under
// manifest.serverNotifications.<type> (manifest-texts.ts).

export interface ServerNoticeSpec {
  // Lowercase letters, digits and dashes: « household », « waitlist ».
  type: string
  // The row's name, « Nouveau foyer », and its line under it, « Quand quelqu'un crée un foyer ».
  label: string
  hint: string | null
}

export const MAX_SERVER_NOTICES = CONFIG.pluginManifest.serverNotices
const TYPE = /^[a-z][a-z0-9-]{0,31}$/
export const NOTICE_LIMITS = {
  label: CONFIG.pluginManifest.noticeLabelMaxLength,
  hint: CONFIG.pluginManifest.noticeHintMaxLength
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fits = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max

// The kinds, or the reason they are refused. A plugin without permissions.notify tells nobody anything.
export const parseServerNotices = (value: unknown, notify: boolean): ServerNoticeSpec[] | string => {
  if (!Array.isArray(value) || value.length > MAX_SERVER_NOTICES) {
    return `serverNotifications must list at most ${MAX_SERVER_NOTICES} kinds`
  }
  if (value.length > 0 && !notify) return 'serverNotifications needs permissions.notify'
  const specs: ServerNoticeSpec[] = []
  for (const [index, entry] of value.entries()) {
    const where = `serverNotifications[${index}]`
    if (!isRecord(entry) || typeof entry.type !== 'string' || !TYPE.test(entry.type)) {
      return `${where}.type must be lowercase letters, digits and dashes`
    }
    if (specs.some(spec => spec.type === entry.type)) return `${where}.type is listed twice`
    if (!fits(entry.label, NOTICE_LIMITS.label)) {
      return `${where}.label must be a non-empty text of at most ${NOTICE_LIMITS.label} characters`
    }
    if (entry.hint !== undefined && !fits(entry.hint, NOTICE_LIMITS.hint)) {
      return `${where}.hint must be a non-empty text of at most ${NOTICE_LIMITS.hint} characters`
    }
    specs.push({ type: entry.type, label: entry.label.trim(), hint: fits(entry.hint, 80) ? entry.hint.trim() : null })
  }
  return specs
}
