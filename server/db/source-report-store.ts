import type { Database } from './database.ts'

// « Signaler » a source: any account tells the server's admin why it should not be there. The admin sees how many
// and why, never who.

export const REPORT_REASONS = ['illegal', 'hateful', 'misleading', 'other'] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

export const isReportReason = (value: unknown): value is ReportReason =>
  typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value)

export interface SourceReports {
  sourceId: string
  count: number
  // How many gave each reason.
  reasons: Record<ReportReason, number>
  // The latest report.
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
  return { sourceId, count: rows.length, reasons, lastAt: Math.max(...rows.map(row => row.at)) }
}

export class SourceReportStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // An account reporting again only changes its reason. true: the first report on this source since the last decision.
  report(sourceId: string, accountId: number, reason: ReportReason, now: number): boolean {
    const first = this.get(sourceId) === null
    this.#db
      .prepare(
        `INSERT INTO source_reports (source_id, reporter, reason, at) VALUES (?, ?, ?, ?)
         ON CONFLICT (source_id, reporter) DO UPDATE SET reason = excluded.reason, at = excluded.at`
      )
      .run(sourceId, `a${accountId}`, reason, now)
    return first
  }

  get(sourceId: string): SourceReports | null {
    const rows = this.#db
      .prepare('SELECT source_id, reason, at FROM source_reports WHERE source_id = ?')
      .all(sourceId) as unknown as ReportRow[]
    return rows.length > 0 ? summaryOf(sourceId, rows) : null
  }

  // Every reported source, the latest report first.
  all(): SourceReports[] {
    const rows = this.#db
      .prepare('SELECT source_id, reason, at FROM source_reports ORDER BY source_id')
      .all() as unknown as ReportRow[]
    const bySource = Map.groupBy(rows, row => row.source_id)
    return [...bySource].map(([id, reports]) => summaryOf(id, reports)).sort((a, b) => b.lastAt - a.lastAt)
  }

  // The admin decided: the reports go, and a new one asks again.
  clear(sourceId: string) {
    this.#db.prepare('DELETE FROM source_reports WHERE source_id = ?').run(sourceId)
  }
}
