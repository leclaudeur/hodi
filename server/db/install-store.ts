import { type Language, isLanguage } from '../../shared/i18n.ts'
import { type Database, transaction } from './database.ts'

// The server's own setup: when its first-run screens were done, and the language and clock it starts everyone with.

export type HourCycle = 12 | 24

export interface Install {
  // null: not set up yet, the app shows the first-run screens.
  setUpAt: number | null
  // The interface's, for everyone who did not pick their own.
  language: Language
  // null: the server's own.
  timeZone: string | null
  // 24: "21:00"; 12: "9:00 PM".
  hourCycle: HourCycle
}

interface InstallRow {
  set_up_at: number | null
  language: string
  time_zone: string | null
  hour_cycle: number
}

export class InstallStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
    this.#db.prepare('INSERT OR IGNORE INTO server_install (id) VALUES (1)').run()
  }

  get(): Install {
    const row = this.#db
      .prepare('SELECT set_up_at, language, time_zone, hour_cycle FROM server_install WHERE id = 1')
      .get() as unknown as InstallRow
    return {
      setUpAt: row.set_up_at,
      language: isLanguage(row.language) ? row.language : 'fr',
      timeZone: row.time_zone,
      hourCycle: row.hour_cycle === 12 ? 12 : 24
    }
  }

  isSetUp() {
    return this.get().setUpAt !== null
  }

  // The first-run screens' answers; false when another device got there first.
  setUp({ language, timeZone }: { language: Language; timeZone: string | null }, now: number) {
    return transaction(this.#db, () => {
      const { changes } = this.#db
        .prepare(
          'UPDATE server_install SET set_up_at = ?, language = ?, time_zone = ? WHERE id = 1 AND set_up_at IS NULL'
        )
        .run(now, language, timeZone)
      // The server's first space counts as set up too, for the statistics that still count by space.
      if (changes === 1) this.#db.prepare('UPDATE accounts SET set_up_at = ? WHERE id = 1').run(now)
      return changes === 1
    })
  }
}
