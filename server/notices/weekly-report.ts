import type { ServerDay } from '../db/server-day-counts.ts'
import { textsIn } from '../i18n.ts'
import type { MailBlock, MailRow } from '../mail/template.ts'
import { type ReportRow, reportRowsIn } from '../plugins/report-rows.ts'
import type { Language } from '../../shared/i18n.ts'
import { DAY_MS } from '../../shared/time.ts'
import type { ServerNotice, ServerNotifier } from './server-notifier.ts'

// « Rapport de la semaine »: on Monday from 08:00, in the server's time zone, the past week's totals beside the week
// before, from the same numbers as Serveur › Vue d'ensemble, then a table from each plugin that keeps a weeklyReport
// hook. Sent once a week: the week it went for is kept, so a restart does not send it again.

export const WEEKLY_REPORT = 'core:weekly-report'
// Checked this often: the report leaves within a quarter of an hour of 08:00.
const CHECK_MS = 15 * 60 * 1000
const SEND_HOUR = 8

export interface Week {
  // Monday and Sunday, YYYY-MM-DD.
  from: string
  to: string
}

// A plugin's table: its name, and its rows as it wrote them.
export interface PluginReport {
  name: string
  rows: ReportRow[]
}

interface ReportDeps {
  week: (week: Week) => { days: ServerDay[]; previous: ServerDay[] }
  plugins: (week: Week) => Promise<PluginReport[]>
  notifier: ServerNotifier
  // The Monday of the last week sent, kept between restarts.
  sent: () => string | null
  markSent: (monday: string) => void
  timeZone: () => string
  now?: () => number
  log?: (line: string) => void
}

const localParts = (now: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit'
  })
    .formatToParts(new Date(now))
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {})
  return { weekday: parts.weekday, day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

// The week that ended last Sunday, once it is Monday 08:00 or later; null on any other day or before then.
export const dueWeek = (now: number, timeZone: string): Week | null => {
  const { weekday, day, hour } = localParts(now, timeZone)
  if (weekday !== 'Mon' || hour < SEND_HOUR) return null
  return { from: shift(day, -7), to: shift(day, -1) }
}

type Totals = Omit<ServerDay, 'day' | 'accounts' | 'activeAccounts'>
const FIGURES = ['visits', 'articles', 'videos', 'minutes', 'shares', 'profiles'] as const

const totalsOf = (days: ServerDay[]): Totals =>
  Object.fromEntries(FIGURES.map(key => [key, days.reduce((sum, day) => sum + day[key], 0)])) as Totals

// « +12 % » beside the week before; nothing when that week had none of it.
const changeOf = (now: number, before: number, language: Language) => {
  if (!before) return undefined
  const percent = Math.round(((now - before) / before) * 100)
  const signs: Record<string, string> = { '1': '+', '-1': '−', '0': '±' }
  const sign = signs[String(Math.sign(percent))]
  return { text: `${sign}${Math.abs(percent)}${language === 'fr' ? '\u00a0%' : '%'}`, good: percent >= 0 }
}

const hoursOf = (minutes: number, language: Language) =>
  minutes < 60 ? `${minutes} min` : `${new Intl.NumberFormat(language).format(Math.round(minutes / 60))} h`

// The week's dates as a title: « Du 9 au 15 novembre », « 9 to 15 November ».
const titleOf = ({ from, to }: Week, language: Language) => {
  const format = (day: string, month: boolean) =>
    new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
      day: 'numeric',
      ...(month ? { month: 'long' } : {}),
      timeZone: 'UTC'
    }).format(new Date(`${day}T12:00:00Z`))
  const sameMonth = from.slice(0, 7) === to.slice(0, 7)
  return textsIn(language)('mail.weekly.title', { from: format(from, !sameMonth), to: format(to, true) })
}

export const reportNotice = (
  week: Week,
  numbers: { days: ServerDay[]; previous: ServerDay[] },
  plugins: PluginReport[],
  language: Language
): ServerNotice => {
  const t = textsIn(language)
  const now = totalsOf(numbers.days)
  const before = totalsOf(numbers.previous)
  const count = (value: number) => new Intl.NumberFormat(language).format(value)
  const row = (key: (typeof FIGURES)[number], value: string): MailRow => {
    const change = changeOf(now[key], before[key], language)
    return { label: t(`mail.weekly.rows.${key}`), value, ...(change ? { change } : {}) }
  }
  const server: MailBlock = {
    kind: 'rows',
    title: t('mail.weekly.server'),
    rows: [
      row('visits', count(now.visits)),
      row('articles', count(now.articles)),
      row('videos', count(now.videos)),
      row('minutes', hoursOf(now.minutes, language)),
      row('shares', count(now.shares)),
      row('profiles', count(now.profiles))
    ]
  }
  const visits = changeOf(now.visits, before.visits, language)
  return {
    from: t('mail.weekly.eyebrow'),
    title: titleOf(week, language),
    text: t('mail.weekly.text'),
    blocks: [
      server,
      ...plugins.map(({ name, rows }) => ({ kind: 'rows' as const, title: name, rows: reportRowsIn(rows, language) }))
    ],
    push: t('mail.weekly.push', {
      visits: `${count(now.visits)}${visits ? ` (${visits.text})` : ''}`,
      articles: count(now.articles)
    }),
    url: '#/server/overview'
  }
}

export const weeklyReport = (deps: ReportDeps) => {
  const now = deps.now ?? Date.now
  let timer: NodeJS.Timeout | null = null
  let running: Promise<void> | null = null

  const send = async () => {
    const week = dueWeek(now(), deps.timeZone())
    if (!week || deps.sent() === week.from) return
    // Kept first: a report that fails halfway is not sent twice to those it reached.
    deps.markSent(week.from)
    const numbers = deps.week(week)
    const plugins = await deps.plugins(week)
    await deps.notifier.tell(WEEKLY_REPORT, language => reportNotice(week, numbers, plugins, language))
  }

  const check = () => {
    running ??= send()
      .catch(error => deps.log?.(`Weekly report failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        running = null
      })
    return running
  }

  return {
    check,
    start: () => {
      timer ??= setInterval(() => void check(), CHECK_MS)
      timer.unref()
      void check()
    },
    stop: () => {
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}
