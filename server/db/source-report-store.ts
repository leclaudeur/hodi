import type { Database } from './database.ts'

// « Signaler » a source: any account tells the server's admin why it should not be there. The admin sees how many
// and why, never who.

export const REPORT_REASONS = ['illegal', 'hateful', 'misleading', 'other'] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

export const isReportReason = (value: unknown): value is ReportReason =>
  typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value)

// After « Ignorer », the accounts that reported keep quiet that long on that source: no loop of notices.
export const IGNORED_MS = 30 * 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

export interface SourceReports {
  sourceId: string
  count: number
  // How many gave each reason.
  reasons: Record<ReportReason, number>
  // The day of the latest report (its midnight, UTC): to the minute, it would point at who was on then.
  lastAt: number
}

interface ReportRow {
  source_id: string
  reason: ReportReason
  at: number
}

const summaryOf = (sourceId: string, rows: ReportRow[]): SourceReports => {
  const reasons = Object.fromEntries(REPORT_REASONS.map(reason => [reason, 0])) as Record<ReportReason, number>
  for (const row of rows) reasons[row.reason] += 1
  const last = Math.max(...rows.map(row => row.at))
  return { sourceId, count: rows.length, reasons, lastAt: last - (last % DAY_MS) }
}

export class SourceReportStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // An account reporting again only changes its reason; one whose report the admin ignored less than 30 days ago
  // stays ignored. true: the first report waiting for the admin on this source.
  report(sourceId: string, accountId: number, reason: ReportReason, now: number): boolean {
    const first = this.get(sourceId) === null
    this.#db
      .prepare(
        `INSERT INTO source_reports (source_id, reporter, reason, at) VALUES (?, ?, ?, ?)
         ON CONFLICT (source_id, reporter) DO UPDATE SET reason = excluded.reason, at = excluded.at,
           ignored_at = CASE WHEN ignored_at > ? THEN ignored_at END`
      )
      .run(sourceId, `a${accountId}`, reason, now, now - IGNORED_MS)
    return first && this.get(sourceId) !== null
  }

  // The reports waiting for the admin, those ignored left out.
  get(sourceId: string): SourceReports | null {
    const rows = this.#db
      .prepare('SELECT source_id, reason, at FROM source_reports WHERE source_id = ? AND ignored_at IS NULL')
      .all(sourceId) as unknown as ReportRow[]
    return rows.length > 0 ? summaryOf(sourceId, rows) : null
  }

  // Every reported source, the latest report first.
  all(): SourceReports[] {
    const rows = this.#db
      .prepare('SELECT source_id, reason, at FROM source_reports WHERE ignored_at IS NULL ORDER BY source_id')
      .all() as unknown as ReportRow[]
    const bySource = Map.groupBy(rows, row => row.source_id)
    return [...bySource].map(([id, reports]) => summaryOf(id, reports)).sort((a, b) => b.lastAt - a.lastAt)
  }

  // « Ignorer »: the source stays, and those who reported it are not heard on it again for 30 days.
  ignore(sourceId: string, now: number) {
    this.#db
      .prepare('UPDATE source_reports SET ignored_at = ? WHERE source_id = ? AND ignored_at IS NULL')
      .run(now, sourceId)
  }

  // Out of the catalogue: nothing left to report.
  clear(sourceId: string) {
    this.#db.prepare('DELETE FROM source_reports WHERE source_id = ?').run(sourceId)
  }
}
