import type { Database } from './database.ts'

// « Signaler ce partage »: someone tells the server's admin that a share they received should not have been sent. The
// admin sees that share only, as it was received, and who sent it; never who reported it.

export const SHARE_REPORT_REASONS = ['harassment', 'hateful', 'spam', 'other'] as const

export type ShareReportReason = (typeof SHARE_REPORT_REASONS)[number]

export const isShareReportReason = (value: unknown): value is ShareReportReason =>
  typeof value === 'string' && (SHARE_REPORT_REASONS as readonly string[]).includes(value)

// Reports one account may send in a day: enough for real trouble, too few to bury the admin.
export const SHARE_REPORTS_PER_DAY = 5
const DAY_MS = 24 * 60 * 60 * 1000
// How long a report the admin handled keeps the same share from being reported again.
const HANDLED_KEPT_MS = 30 * DAY_MS

export interface ShareReport {
  id: number
  // The sender's account, null once it is gone.
  sender: number | null
  senderName: string
  // The card as it was received.
  item: { title: string; sourceName: string; link: string; kind: string }
  note: string | null
  reason: ShareReportReason
  // Its day (midnight, UTC): to the minute, it would point at who was on then.
  day: number
}

interface ReportRow {
  id: number
  sender: number | null
  sender_name: string
  item: string
  note: string | null
  reason: ShareReportReason
  at: number
}

const itemOf = (json: string): ShareReport['item'] => {
  const item = JSON.parse(json) as Record<string, unknown>
  const text = (key: string) => (typeof item[key] === 'string' ? (item[key] as string) : '')
  return { title: text('title'), sourceName: text('sourceName'), link: text('link'), kind: text('kind') }
}

const toReport = (row: ReportRow): ShareReport => ({
  id: row.id,
  sender: row.sender,
  senderName: row.sender_name,
  item: itemOf(row.item),
  note: row.note,
  reason: row.reason,
  day: row.at - (row.at % DAY_MS)
})

const COLUMNS = 'id, sender, sender_name, item, note, reason, at'

export type ReportOutcome = { id: number } | 'not_found' | 'already' | 'too_many'

export class ShareReportStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // The share this profile received from that one, copied as it is now; the reporter is the account reading it.
  report(
    share: { profileId: number; fromProfile: number; articleId: string },
    reporter: number,
    reason: ShareReportReason,
    now: number
  ): ReportOutcome {
    const received = this.#db
      .prepare(
        `SELECT s.item, s.note, p.name, p.user_id FROM shares s JOIN profiles p ON p.id = s.from_profile
         WHERE s.profile_id = ? AND s.from_profile = ? AND s.article_id = ?`
      )
      .get(share.profileId, share.fromProfile, share.articleId) as
      { item: string; note: string | null; name: string; user_id: number | null } | undefined
    if (!received) return 'not_found'
    this.#db.prepare('DELETE FROM share_reports WHERE handled_at < ?').run(now - HANDLED_KEPT_MS)
    const key = `a${reporter}`
    const today = this.#db
      .prepare('SELECT COUNT(*) AS n FROM share_reports WHERE reporter = ? AND at > ?')
      .get(key, now - DAY_MS) as { n: number }
    const known = this.#db
      .prepare('SELECT 1 FROM share_reports WHERE reporter = ? AND from_profile = ? AND article_id = ?')
      .get(key, share.fromProfile, share.articleId)
    if (known) return 'already'
    if (today.n >= SHARE_REPORTS_PER_DAY) return 'too_many'
    const { lastInsertRowid } = this.#db
      .prepare(
        `INSERT INTO share_reports (reporter, from_profile, sender, sender_name, article_id, item, note, reason, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        key,
        share.fromProfile,
        received.user_id,
        received.name,
        share.articleId,
        received.item,
        received.note,
        reason,
        now
      )
    return { id: Number(lastInsertRowid) }
  }

  get(id: number): ShareReport | null {
    const row = this.#db.prepare(`SELECT ${COLUMNS} FROM share_reports WHERE id = ? AND handled_at IS NULL`).get(id) as
      ReportRow | undefined
    return row ? toReport(row) : null
  }

  // The latest first.
  all(): ShareReport[] {
    return (
      this.#db
        .prepare(`SELECT ${COLUMNS} FROM share_reports WHERE handled_at IS NULL ORDER BY at DESC, id DESC`)
        .all() as unknown as ReportRow[]
    ).map(toReport)
  }

  // « Ignorer »: it leaves À traiter, and still keeps the same share from being reported again for a month.
  handle(id: number, now: number) {
    return (
      this.#db.prepare('UPDATE share_reports SET handled_at = ? WHERE id = ? AND handled_at IS NULL').run(now, id)
        .changes > 0
    )
  }
}
