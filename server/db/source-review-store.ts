import type { Database } from './database.ts'
import { CONFIG } from '../fixed-config.ts'

// À traiter's sources: those added while the server validates them, until its admin accepts or refuses each. Who
// added one is never kept here: the admin judges the source, not the person.

// A refused source is asked about again once a month at most, so that adding its link over and over never floods the
// admin with requests.
export const ASK_AGAIN_AFTER = CONFIG.sources.reviewAskAgainAfter

export type ReviewState = 'pending' | 'accepted' | 'refused'

export interface SourceReview {
  sourceId: string
  state: ReviewState
  teen: boolean
  child: boolean
  askedAt: number
  decidedAt: number | null
}

interface ReviewRow {
  source_id: string
  state: ReviewState
  teen: number
  child: number
  asked_at: number
  decided_at: number | null
}

const toReview = (row: ReviewRow): SourceReview => ({
  sourceId: row.source_id,
  state: row.state,
  teen: row.teen === 1,
  child: row.child === 1,
  askedAt: row.asked_at,
  decidedAt: row.decided_at
})

export class SourceReviewStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  // Serveur › Contenu's « Valider les sources »: off by default, a server for one family trusts its own.
  validating(): boolean {
    const row = this.#db.prepare("SELECT value FROM server_settings WHERE key = 'sourceValidation'").get() as
      { value: number } | undefined
    return row?.value === 1
  }

  setValidating(on: boolean) {
    if (on)
      this.#db
        .prepare(
          "INSERT INTO server_settings (key, value) VALUES ('sourceValidation', 1) ON CONFLICT (key) DO UPDATE SET value = 1"
        )
        .run()
    else this.#db.prepare("DELETE FROM server_settings WHERE key = 'sourceValidation'").run()
  }

  // A source just added waits; added again after a refusal, it waits again.
  ask(sourceId: string, now: number) {
    this.#db
      .prepare(
        `INSERT INTO source_reviews (source_id, state, asked_at) VALUES (?, 'pending', ?)
         ON CONFLICT (source_id) DO UPDATE SET state = 'pending', asked_at = excluded.asked_at, decided_at = NULL`
      )
      .run(sourceId, now)
  }

  get(sourceId: string): SourceReview | null {
    const row = this.#db.prepare('SELECT * FROM source_reviews WHERE source_id = ?').get(sourceId) as
      ReviewRow | undefined
    return row ? toReview(row) : null
  }

  // The oldest first, as they came.
  pending(): SourceReview[] {
    return (
      this.#db
        .prepare("SELECT * FROM source_reviews WHERE state = 'pending' ORDER BY asked_at, source_id")
        .all() as unknown as ReviewRow[]
    ).map(toReview)
  }

  // false: the source waits on no decision.
  decide(sourceId: string, decision: { state: 'accepted' | 'refused'; teen: boolean; child: boolean }, now: number) {
    const result = this.#db
      .prepare(
        `UPDATE source_reviews SET state = ?, teen = ?, child = ?, decided_at = ?
         WHERE source_id = ? AND state = 'pending'`
      )
      .run(decision.state, decision.teen ? 1 : 0, decision.child ? 1 : 0, now, sourceId)
    return Number(result.changes) > 0
  }

  // « Retirer du catalogue », after a report: refused as if it had waited, it stays with those who read it.
  unlist(sourceId: string, now: number) {
    this.#db
      .prepare(
        `INSERT INTO source_reviews (source_id, state, asked_at, decided_at) VALUES (?, 'refused', ?, ?)
         ON CONFLICT (source_id) DO UPDATE SET state = 'refused', teen = 0, child = 0, decided_at = excluded.decided_at`
      )
      .run(sourceId, now, now)
  }

  // Added again after a refusal: asked anew only once the refusal is a month old.
  mayAskAgain(sourceId: string, now: number): boolean {
    const review = this.get(sourceId)
    return review?.state === 'refused' && (review.decidedAt ?? 0) <= now - ASK_AGAIN_AFTER
  }

  // Out of the catalogue: still waiting, or refused. They keep working for those who read them.
  unlisted(): Set<string> {
    const rows = this.#db.prepare("SELECT source_id FROM source_reviews WHERE state != 'accepted'").all() as {
      source_id: string
    }[]
    return new Set(rows.map(row => row.source_id))
  }
}
