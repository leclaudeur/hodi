import { CONFIG } from '../fixed-config.ts'

// What a plugin may put in an e-mail (ctx.mail.send), checked field by field: one plain address, a one-line subject,
// plain text, and the template's optional blocks. Anything else it adds is left behind.

export interface PluginMailMessage {
  to: string
  subject: string
  // Its paragraphs, apart by an empty line; <i>…</i> puts a name in italics.
  text: string
  // The card's title; the subject without one.
  title?: string
  // The small line above the title; none without one.
  eyebrow?: string
  // A code to type somewhere, in large letters, and the line under it.
  code?: string
  caption?: string
  // One button, its link written under it for the mail apps that show it badly.
  action?: { label: string; url: string }
  // The last words, under a line.
  note?: string
  // The language of what Hodi adds (the line naming the plugin, the punctuation): the plugin's text's, for someone
  // without an account yet. Without it, the recipient's account's, or French.
  language?: 'fr' | 'en'
}

const MAX_ADDRESS = CONFIG.pluginMail.addressMaxLength
const MAX_SUBJECT = CONFIG.pluginMail.subjectMaxLength
const MAX_TEXT = CONFIG.pluginMail.textMaxLength
const MAX_LINE = CONFIG.pluginMail.lineMaxLength
const MAX_NOTE = CONFIG.pluginMail.noteMaxLength
const MAX_URL = CONFIG.pluginMail.urlMaxLength
// One plain address, nothing around it: no display name, no list, no comment, no line break.
const ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/
// Any control character, line breaks included: a subject is one line.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/
// The text may have line breaks, but no other control character.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const TEXT_CONTROL = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/
// Letters, digits and dashes: « K7QM-4RWD ».
const CODE = /^[A-Za-z0-9-]{1,32}$/
// A web address, with nothing that could leave the href.
const URL = /^https?:\/\/[^\s"'<>\\]+$/

const line = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max && !CONTROL.test(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max && !TEXT_CONTROL.test(value)
// An optional field: missing, or right.
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value)

const isAction = (value: unknown): value is { label: string; url: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { label, url } = value as Record<string, unknown>
  return line(label, 60) && typeof url === 'string' && url.length <= MAX_URL && URL.test(url)
}

// The fields a plugin may give, or null when one is missing, too long, or could carry a header or markup.
export const pluginMailMessage = (value: unknown): PluginMailMessage | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const {
    to,
    subject,
    text: body,
    title,
    eyebrow,
    code,
    caption,
    action,
    note,
    language
  } = value as Record<string, unknown>
  if (typeof to !== 'string' || to.length > MAX_ADDRESS || !ADDRESS.test(to)) return null
  if (!line(subject, MAX_SUBJECT) || !text(body, MAX_TEXT)) return null
  const checks = [
    optional(title, v => line(v, MAX_LINE)),
    optional(eyebrow, v => line(v, 60)),
    optional(code, v => typeof v === 'string' && CODE.test(v)),
    optional(caption, v => line(v, MAX_LINE)),
    optional(action, isAction),
    optional(note, v => text(v, MAX_NOTE)),
    optional(language, v => v === 'fr' || v === 'en')
  ]
  if (checks.includes(false)) return null
  const optionalFields = { title, eyebrow, code, caption, note, language } as Record<string, string | undefined>
  const kept = Object.fromEntries(Object.entries(optionalFields).filter(([, field]) => field !== undefined))
  const button = action as PluginMailMessage['action']
  return { to, subject, text: body, ...kept, ...(button ? { action: { label: button.label, url: button.url } } : {}) }
}
