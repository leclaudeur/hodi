import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { migrate, versionBefore } from '../db/migrations.ts'
import { UserStore } from '../db/user-store.ts'

const NOW = Date.UTC(2026, 10, 5, 12)

describe('Poudré in English', () => {
  it('moves the stored poudre theme to powder, and sends it again to that profile’s devices', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore("json_set(value, '$.theme', 'powder')"))
    // Written as the schema of then stood: the store reads columns added since.
    const other = Number(
      db
        .prepare(
          "INSERT INTO profiles (account_id, name, color, position, created_at) VALUES (1, 'Julie', 'tech', 1, ?)"
        )
        .run(NOW).lastInsertRowid
    )
    db.prepare(
      `INSERT INTO profile_settings (profile_id, key, value, updated_at)
       VALUES (1, 'preferences', ?, ?), (1, 'revision', '4', ?), (?, 'preferences', ?, ?), (?, 'revision', '9', ?)`
    ).run(
      JSON.stringify({ theme: 'poudre', mutedWords: ['foot'] }),
      NOW,
      NOW,
      other,
      JSON.stringify({ theme: 'dark' }),
      NOW,
      other,
      NOW
    )

    migrate(db)

    const admin = new UserStore(db, 1)
    assert.deepEqual(admin.preferences(), { theme: 'powder', mutedWords: ['foot'] })
    assert.equal(admin.revision, 5)
    const julie = new UserStore(db, other)
    assert.deepEqual(julie.preferences(), { theme: 'dark' })
    assert.equal(julie.revision, 9)
  })
})
