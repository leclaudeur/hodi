import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { type TestPlugin, testPlugin } from '../../plugin-sdk/testing.ts'
import { openDatabase } from '../db/database.ts'
import type { ServerDay } from '../db/server-day-counts.ts'
import { ServerSettingsStore } from '../db/server-settings-store.ts'
import type { ServerNotice, ServerNoticeIn } from '../notices/server-notifier.ts'
import { WEEKLY_REPORT, dueWeek, reportNotice, weeklyReport } from '../notices/weekly-report.ts'
import { pluginReportRows, reportRowsIn } from '../plugins/report-rows.ts'

// Monday 16 November 2026, 08:05 in Brussels (07:05 UTC).
const MONDAY = Date.UTC(2026, 10, 16, 7, 5)
const HOUR = 60 * 60 * 1000
const WEEK = { from: '2026-11-09', to: '2026-11-15' }

const day = (values: Partial<ServerDay>): ServerDay => ({
  day: '2026-11-09',
  visits: 0,
  articles: 0,
  videos: 0,
  minutes: 0,
  shares: 0,
  profiles: 0,
  accounts: 0,
  activeAccounts: 0,
  ...values
})
const NUMBERS = {
  days: [
    day({ visits: 300, articles: 1000, minutes: 2000, shares: 4 }),
    day({ visits: 112, articles: 284, profiles: 2 })
  ],
  previous: [day({ visits: 368, articles: 1284, minutes: 2000 })]
}

describe('the weekly report', () => {
  it('is due on Monday from 08:00 in the server’s time zone, for the week before', () => {
    assert.equal(dueWeek(MONDAY - HOUR, 'Europe/Brussels'), null)
    assert.deepEqual(dueWeek(MONDAY, 'Europe/Brussels'), WEEK)
    assert.deepEqual(dueWeek(MONDAY + 15 * HOUR, 'Europe/Brussels'), WEEK)
    assert.equal(dueWeek(MONDAY + 24 * HOUR, 'Europe/Brussels'), null)
    // Still Sunday evening in New York.
    assert.equal(dueWeek(MONDAY, 'America/New_York'), null)
  })

  it('gives the week’s totals beside the week before, then each plugin’s table', () => {
    const plugins = [{ name: 'Village', rows: [{ label: 'Nouveaux foyers', value: '2' }] }]
    const notice = reportNotice(WEEK, NUMBERS, plugins, 'fr')
    assert.equal(notice.from, 'Rapport de la semaine')
    assert.equal(notice.title, 'Du 9 au 15 novembre')
    assert.equal(notice.url, '#/server/overview')
    assert.equal(notice.push, 'Visites : 412 (+12\u00a0%) · Articles lus : 1\u202f284')
    assert.deepEqual(notice.blocks, [
      {
        kind: 'rows',
        title: 'Serveur',
        rows: [
          { label: 'Visites', value: '412', change: { text: '+12\u00a0%', good: true } },
          { label: 'Articles lus', value: '1 284', change: { text: '±0\u00a0%', good: true } },
          { label: 'Vidéos vues', value: '0' },
          { label: 'Temps de lecture', value: '33 h', change: { text: '±0\u00a0%', good: true } },
          { label: 'Partages', value: '4' },
          { label: 'Nouveaux profils', value: '2' }
        ]
      },
      { kind: 'rows', title: 'Village', rows: [{ label: 'Nouveaux foyers', value: '2' }] }
    ])
    assert.equal(
      reportNotice({ from: '2026-09-28', to: '2026-10-04' }, NUMBERS, [], 'fr').title,
      'Du 28 septembre au 4 octobre'
    )
    const english = reportNotice(WEEK, { days: NUMBERS.days, previous: [day({ visits: 500 })] }, [], 'en')
    assert.equal(english.title, '9 to 15 November')
    assert.deepEqual(english.blocks?.[0]?.kind === 'rows' && english.blocks[0].rows[0], {
      label: 'Visits',
      value: '412',
      change: { text: '−18%', good: false }
    })
  })

  it('goes once a week, even across a restart', async () => {
    const db = openDatabase(':memory:')
    const settings = new ServerSettingsStore(db)
    const told: { type: string; notice: ServerNotice }[] = []
    const clock = { now: MONDAY - HOUR }
    const report = () =>
      weeklyReport({
        week: () => NUMBERS,
        plugins: async () => [],
        notifier: {
          tell: async (type: string, notice: ServerNoticeIn) => {
            told.push({ type, notice: typeof notice === 'function' ? notice('fr') : notice })
            return { emails: 1, pushes: 0 }
          }
        },
        sent: () => settings.weeklyReportSent(),
        markSent: monday => settings.setWeeklyReportSent(monday),
        timeZone: () => 'Europe/Brussels',
        now: () => clock.now
      })
    await report().check()
    assert.equal(told.length, 0)
    clock.now = MONDAY
    await report().check()
    await report().check()
    assert.equal(told.length, 1)
    assert.equal(told[0]?.type, WEEKLY_REPORT)
    assert.equal(new ServerSettingsStore(db).weeklyReportSent(), '2026-11-09')
    clock.now = MONDAY + 7 * 24 * HOUR
    await report().check()
    assert.equal(told.length, 2)
  })

  it('takes a plugin’s rows as plain text, one to eight', () => {
    const row = { label: 'Nouveaux foyers', value: '2', change: { text: '+1', good: true } }
    assert.deepEqual(pluginReportRows({ rows: [row] }), [row])
    const refused = [
      null,
      { rows: [] },
      { rows: Array.from({ length: 9 }, () => row) },
      { rows: [{ label: 'a' }] },
      { rows: [{ label: 'a\nb', value: '1' }] },
      { rows: [{ label: 'a', value: 'x'.repeat(31) }] },
      { rows: [{ label: 'a', value: '1', change: { text: '+1' } }] },
      { rows: [{ label: '<b>a</b>'.repeat(10), value: '1' }] },
      { rows: [{ label: { de: 'a' }, value: '1' }] },
      { rows: [{ label: { fr: 'a', en: '' }, value: '1' }] }
    ]
    for (const value of refused) assert.equal(pluginReportRows(value), null, JSON.stringify(value))
  })

  it('shows each admin a plugin’s rows in their language, or in French when it lacks it', () => {
    const rows = pluginReportRows({
      rows: [
        {
          label: { fr: 'Nouveaux foyers', en: 'New households' },
          value: '2',
          change: { text: { fr: '+1' }, good: true }
        },
        { label: { en: 'Waiting' }, value: { fr: '4 personnes', en: '4 people' } }
      ]
    })!
    assert.deepEqual(reportRowsIn(rows, 'en'), [
      { label: 'New households', value: '2', change: { text: '+1', good: true } },
      { label: 'Waiting', value: '4 people' }
    ])
    assert.deepEqual(reportRowsIn(rows, 'fr')[1], { label: 'Waiting', value: '4 personnes' })
  })
})

describe('a plugin’s weeklyReport', () => {
  const kits: TestPlugin[] = []
  after(async () => {
    await Promise.all(kits.map(kit => kit.stop()))
  })

  it('adds its table under its name, and is left out when it answers wrong', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'hodi-weekly-'))
    writeFileSync(
      path.join(folder, 'plugin.json'),
      JSON.stringify({ id: 'village', name: 'Village', version: '0.1.0', description: 'Des foyers.', api: 2 })
    )
    mkdirSync(path.join(folder, 'server'))
    writeFileSync(
      path.join(folder, 'server', 'index.js'),
      `export default {
        weeklyReport: async ({ from }) => from === '2026-11-09'
          ? { rows: [{ label: 'Nouveaux foyers', value: '2', change: { text: '+1', good: true } }] }
          : { rows: 'none' }
      }`
    )
    const kit = await testPlugin(folder)
    kits.push(kit)
    assert.deepEqual(await kit.registry.weeklyReports(WEEK), [
      { name: 'Village', rows: [{ label: 'Nouveaux foyers', value: '2', change: { text: '+1', good: true } }] }
    ])
    assert.deepEqual(await kit.registry.weeklyReports({ from: '2026-11-16', to: '2026-11-22' }), [])
    assert.ok(kit.log.some(line => line.includes('weeklyReport answered')))
  })
})
